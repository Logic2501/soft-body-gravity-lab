class_name SoftBodySim
extends RefCounted

## Independent 2D point-mass soft body solver.
##
## The ring is solved with position-based dynamics: predicted positions are
## corrected by distance, bending, signed-area and weak radial-shape
## constraints, then velocities are derived from the corrected positions.
## The gravity/central field acts on every perimeter particle independently.

const SEGMENTS := 32
var solver_iterations := 6
var bending_stiffness := 0.04

const DEFAULT_GRAVITY := 900.0
const DEFAULT_CENTER_MU := 90.0e6
const DEFAULT_CENTER_EPSILON := 70.0
const DEFAULT_EDGE_STIFFNESS := 0.35
const DEFAULT_AREA_STRENGTH := 0.35
const DEFAULT_SHAPE_STRENGTH := 0.02
const DEFAULT_DAMPING := 0.4
const DEFAULT_RESTITUTION := 0.45
const DEFAULT_WALL_FRICTION := 0.12
const DEFAULT_MAX_SPEED := 2600.0

var grab_stiffness := 400.0
var grab_max_accel := 22000.0
const MAX_CENTER_ACCEL := 9000.0
const WALL_EPSILON := 0.01
const SETTLE_SPEED := 24.0

var positions := PackedVector2Array()
var velocities := PackedVector2Array()
var initial_positions := PackedVector2Array()
var rest_edge_lengths := PackedFloat32Array()
var rest_skip_lengths := PackedFloat32Array()

var arena_rect := Rect2()
var center_pos := Vector2.ZERO
var rest_radius := 64.0
var rest_area := 0.0
var centroid := Vector2.ZERO

var gravity := DEFAULT_GRAVITY
var center_mu := DEFAULT_CENTER_MU
var center_epsilon := DEFAULT_CENTER_EPSILON
var edge_stiffness := DEFAULT_EDGE_STIFFNESS
var area_strength := DEFAULT_AREA_STRENGTH
var shape_strength := DEFAULT_SHAPE_STRENGTH
var damping := DEFAULT_DAMPING
var restitution := DEFAULT_RESTITUTION
var wall_friction := DEFAULT_WALL_FRICTION
var max_speed := DEFAULT_MAX_SPEED

var grab_index := -1
var grab_target := Vector2.ZERO

var last_max_speed := 0.0
var last_area_error := 0.0
var last_contact := false
var last_max_center_accel := 0.0
var last_instability := false


func setup(p_arena: Rect2, p_center: Vector2, spawn_center: Vector2, p_radius: float) -> void:
	arena_rect = p_arena
	center_pos = p_center
	rest_radius = p_radius
	positions.resize(SEGMENTS)
	velocities.resize(SEGMENTS)
	initial_positions.resize(SEGMENTS)
	for i in SEGMENTS:
		var angle := TAU * float(i) / float(SEGMENTS)
		var point := spawn_center + Vector2(cos(angle), sin(angle)) * rest_radius
		initial_positions[i] = point
	rest_edge_lengths.resize(SEGMENTS)
	rest_skip_lengths.resize(SEGMENTS)
	for i in SEGMENTS:
		rest_edge_lengths[i] = initial_positions[i].distance_to(initial_positions[(i + 1) % SEGMENTS])
		rest_skip_lengths[i] = initial_positions[i].distance_to(initial_positions[(i + 2) % SEGMENTS])
	rest_area = _signed_area(initial_positions)
	reset()


func reset() -> void:
	positions = initial_positions.duplicate()
	velocities.resize(SEGMENTS)
	velocities.fill(Vector2.ZERO)
	centroid = _average(positions)
	grab_index = -1
	grab_target = centroid
	last_max_speed = 0.0
	last_area_error = 0.0
	last_contact = false
	last_max_center_accel = 0.0
	last_instability = false


func step(dt: float) -> void:
	if positions.size() < 3 or dt <= 0.0:
		return
	last_instability = false
	var old_positions := positions.duplicate()
	_apply_external_acceleration(dt)
	for i in SEGMENTS:
		positions[i] += velocities[i] * dt

	for _iteration in solver_iterations:
		_solve_distance_constraints()
		_solve_area_constraint()
		_solve_shape_constraint()
		_clamp_to_arena()

	for i in SEGMENTS:
		velocities[i] = (positions[i] - old_positions[i]) / dt

	_handle_wall_response()
	var damp_factor := exp(-maxf(damping, 0.0) * dt)
	for i in SEGMENTS:
		velocities[i] *= damp_factor
		_limit_speed(i)
		if not _vector_is_finite(positions[i]) or not _vector_is_finite(velocities[i]):
			reset()
			last_instability = true
			return

	centroid = _average(positions)
	_update_metrics()


func _apply_external_acceleration(dt: float) -> void:
	last_max_center_accel = 0.0
	for i in SEGMENTS:
		var accel := Vector2(0.0, gravity)
		var center_accel := _center_acceleration(positions[i])
		last_max_center_accel = maxf(last_max_center_accel, center_accel.length())
		accel += center_accel
		if i == grab_index:
			accel += _grab_acceleration(positions[i])
		velocities[i] += accel * dt


func _center_acceleration(point: Vector2) -> Vector2:
	if center_mu <= 0.0:
		return Vector2.ZERO
	var to_center := center_pos - point
	var dist_sq := to_center.length_squared()
	var softened := dist_sq + center_epsilon * center_epsilon
	if softened <= 1.0e-9:
		return Vector2.ZERO
	var accel := to_center * (center_mu / pow(softened, 1.5))
	var length := accel.length()
	if length > MAX_CENTER_ACCEL:
		accel = accel * (MAX_CENTER_ACCEL / length)
	return accel


func _grab_acceleration(point: Vector2) -> Vector2:
	var accel := (grab_target - point) * grab_stiffness
	var length := accel.length()
	if length > grab_max_accel:
		accel = accel * (grab_max_accel / length)
	return accel


func _solve_distance_constraints() -> void:
	for i in SEGMENTS:
		var next := (i + 1) % SEGMENTS
		_solve_distance(i, next, rest_edge_lengths[i], edge_stiffness)
		var skip := (i + 2) % SEGMENTS
		_solve_distance(i, skip, rest_skip_lengths[i], bending_stiffness)


func _solve_distance(a: int, b: int, rest_length: float, stiffness: float) -> void:
	var pa := positions[a]
	var pb := positions[b]
	var delta := pb - pa
	var distance := delta.length()
	if distance < 1.0e-6:
		delta = Vector2(1.0, 0.0)
		distance = 1.0e-6
	var correction := (distance - rest_length) / distance * 0.5 * clampf(stiffness, 0.0, 1.0)
	var offset := delta * correction
	positions[a] = pa + offset
	positions[b] = pb - offset


func _solve_area_constraint() -> void:
	if area_strength <= 0.0:
		return
	var area := _signed_area(positions)
	var error := area - rest_area
	var gradients := PackedVector2Array()
	gradients.resize(SEGMENTS)
	var gradient_sum := 0.0
	for i in SEGMENTS:
		var prev := positions[(i - 1 + SEGMENTS) % SEGMENTS]
		var next := positions[(i + 1) % SEGMENTS]
		var gradient := Vector2(0.5 * (next.y - prev.y), 0.5 * (prev.x - next.x))
		gradients[i] = gradient
		gradient_sum += gradient.length_squared()
	if gradient_sum < 1.0e-9:
		return
	var factor := -error / gradient_sum * clampf(area_strength, 0.0, 1.0)
	for i in SEGMENTS:
		positions[i] += gradients[i] * factor


func _solve_shape_constraint() -> void:
	if shape_strength <= 0.0:
		return
	var center := _average(positions)
	var strength := clampf(shape_strength, 0.0, 1.0)
	for i in SEGMENTS:
		var offset := positions[i] - center
		var distance := offset.length()
		if distance < 1.0e-6:
			continue
		var correction := (distance - rest_radius) * strength
		positions[i] -= offset * (correction / distance)


func _clamp_to_arena() -> void:
	var min_x := arena_rect.position.x
	var min_y := arena_rect.position.y
	var max_x := arena_rect.end.x
	var max_y := arena_rect.end.y
	for i in SEGMENTS:
		var p := positions[i]
		p.x = clampf(p.x, min_x, max_x)
		p.y = clampf(p.y, min_y, max_y)
		positions[i] = p


func _handle_wall_response() -> void:
	last_contact = false
	var min_x := arena_rect.position.x
	var min_y := arena_rect.position.y
	var max_x := arena_rect.end.x
	var max_y := arena_rect.end.y
	var tangent_keep := 1.0 - clampf(wall_friction, 0.0, 1.0)
	for i in SEGMENTS:
		var p := positions[i]
		var v := velocities[i]
		var touched := false
		if p.x <= min_x + WALL_EPSILON:
			touched = true
			if v.x < 0.0:
				v.x = -v.x * restitution
				if absf(v.x) < SETTLE_SPEED:
					v.x = 0.0
			v.y *= tangent_keep
		elif p.x >= max_x - WALL_EPSILON:
			touched = true
			if v.x > 0.0:
				v.x = -v.x * restitution
				if absf(v.x) < SETTLE_SPEED:
					v.x = 0.0
			v.y *= tangent_keep
		if p.y <= min_y + WALL_EPSILON:
			touched = true
			if v.y < 0.0:
				v.y = -v.y * restitution
				if absf(v.y) < SETTLE_SPEED:
					v.y = 0.0
			v.x *= tangent_keep
		elif p.y >= max_y - WALL_EPSILON:
			touched = true
			if v.y > 0.0:
				v.y = -v.y * restitution
				if absf(v.y) < SETTLE_SPEED:
					v.y = 0.0
			v.x *= tangent_keep
		velocities[i] = v
		if touched:
			last_contact = true


func _limit_speed(index: int) -> void:
	var speed := velocities[index].length()
	if speed > max_speed and speed > 0.0:
		velocities[index] *= max_speed / speed


func _update_metrics() -> void:
	last_max_speed = 0.0
	for v in velocities:
		last_max_speed = maxf(last_max_speed, v.length())
	var area := absf(_signed_area(positions))
	var target := absf(rest_area)
	last_area_error = 0.0 if target < 1.0e-9 else absf(area - target) / target


func _signed_area(points: PackedVector2Array) -> float:
	var total := 0.0
	var count := points.size()
	for i in count:
		var a := points[i]
		var b := points[(i + 1) % count]
		total += a.x * b.y - b.x * a.y
	return total * 0.5


func _average(points: PackedVector2Array) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	var total := Vector2.ZERO
	for p in points:
		total += p
	return total / float(points.size())


func _vector_is_finite(value: Vector2) -> bool:
	return not is_nan(value.x) and not is_inf(value.x) and not is_nan(value.y) and not is_inf(value.y)


func grab_at(point: Vector2, max_distance: float = 110.0) -> bool:
	var best_index := -1
	var best_dist_sq := max_distance * max_distance
	for i in SEGMENTS:
		var dist_sq := positions[i].distance_squared_to(point)
		if dist_sq < best_dist_sq:
			best_dist_sq = dist_sq
			best_index = i
	grab_index = best_index
	if grab_index >= 0:
		grab_target = _clamp_point(point)
	return grab_index >= 0


func update_grab(point: Vector2) -> void:
	if grab_index >= 0:
		grab_target = _clamp_point(point)


func release_grab() -> void:
	grab_index = -1


func _clamp_point(point: Vector2) -> Vector2:
	return Vector2(
		clampf(point.x, arena_rect.position.x, arena_rect.end.x),
		clampf(point.y, arena_rect.position.y, arena_rect.end.y)
	)


func get_body_radius() -> float:
	var total := 0.0
	if positions.is_empty():
		return rest_radius
	for p in positions:
		total += p.distance_to(centroid)
	return total / float(positions.size())
