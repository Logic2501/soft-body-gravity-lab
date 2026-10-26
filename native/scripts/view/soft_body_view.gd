class_name SoftBodyView
extends Node2D

const SUBDIVISIONS := 6
const SMOOTH_PASSES := 1
const SMOOTH_STRENGTH := 0.22

const OUTLINE_DARK := Color(0.05, 0.28, 0.24, 1.0)
const OUTLINE_RIM := Color(0.62, 1.0, 0.90, 0.95)
const BODY_EDGE := Color(0.18, 0.68, 0.52, 1.0)
const BODY_CENTER := Color(0.53, 0.95, 0.74, 1.0)
const SHADOW := Color(0.0, 0.0, 0.0, 0.22)
const TETHER := Color(1.0, 0.82, 0.36, 0.9)

var sim: SoftBodySim
var arena_rect := Rect2()
var debug_draw := false


func setup(p_sim: SoftBodySim, p_arena: Rect2) -> void:
	sim = p_sim
	arena_rect = p_arena


func _process(_delta: float) -> void:
	queue_redraw()


func _draw() -> void:
	if sim == null or sim.positions.size() < 3:
		return
	var outline := _build_outline()
	if outline.size() < 3:
		return
	var center := sim.centroid

	var shadow := PackedVector2Array()
	for p in outline:
		shadow.append(p + Vector2(7.0, 9.0))
	draw_colored_polygon(shadow, SHADOW)

	var bands := 10
	for band in bands:
		var t := float(band) / float(bands - 1)
		var scale := lerpf(1.0, 0.70, t)
		var points := PackedVector2Array()
		for p in outline:
			points.append(center + (p - center) * scale)
		draw_colored_polygon(points, BODY_EDGE.lerp(BODY_CENTER, t))

	var closed := outline.duplicate()
	closed.append(outline[0])
	draw_polyline(closed, OUTLINE_DARK, 6.0, true)
	draw_polyline(closed, OUTLINE_RIM, 2.2, true)

	if debug_draw:
		_draw_debug(center)

	if sim.grab_index >= 0:
		var grabbed := sim.positions[sim.grab_index]
		draw_line(grabbed, sim.grab_target, TETHER, 2.0, true)
		draw_circle(sim.grab_target, 5.0, Color(TETHER, 0.85))
		draw_arc(grabbed, 7.0, 0.0, TAU, 24, TETHER, 2.0, true)


func _draw_debug(center: Vector2) -> void:
	var n := sim.positions.size()
	for i in n:
		draw_line(sim.positions[i], sim.positions[(i + 1) % n], Color(0.55, 0.95, 1.0, 0.45), 1.0, true)
		draw_line(sim.positions[i], sim.positions[(i + 2) % n], Color(0.95, 0.70, 0.35, 0.35), 1.0, true)
		draw_line(sim.positions[i], center, Color(0.95, 0.55, 0.85, 0.18), 1.0, true)
	for p in sim.positions:
		draw_circle(p, 3.0, Color(0.93, 1.0, 1.0, 0.95))
	draw_circle(center, 3.5, Color(1.0, 0.82, 0.36, 1.0))


func _build_outline() -> PackedVector2Array:
	var n := sim.positions.size()
	var raw := PackedVector2Array()
	for i in n:
		var p0 := sim.positions[(i - 1 + n) % n]
		var p1 := sim.positions[i]
		var p2 := sim.positions[(i + 1) % n]
		var p3 := sim.positions[(i + 2) % n]
		for j in SUBDIVISIONS:
			var t := float(j) / float(SUBDIVISIONS)
			raw.append(_catmull_rom(p0, p1, p2, p3, t))

	var smoothed := raw
	for _pass in SMOOTH_PASSES:
		var temp := PackedVector2Array()
		temp.resize(smoothed.size())
		var count := smoothed.size()
		for i in count:
			var previous := smoothed[(i - 1 + count) % count]
			var current := smoothed[i]
			var next := smoothed[(i + 1) % count]
			temp[i] = current.lerp((previous + current + next) / 3.0, SMOOTH_STRENGTH)
		smoothed = temp

	var inset := 1.0
	for i in smoothed.size():
		var p := smoothed[i]
		p.x = clampf(p.x, arena_rect.position.x + inset, arena_rect.end.x - inset)
		p.y = clampf(p.y, arena_rect.position.y + inset, arena_rect.end.y - inset)
		smoothed[i] = p
	return smoothed


func _catmull_rom(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	var tangent_out := 0.5 * (p2 - p0)
	var tangent_in := 0.5 * (p3 - p1)
	var h00 := 2.0 * t3 - 3.0 * t2 + 1.0
	var h10 := t3 - 2.0 * t2 + t
	var h01 := -2.0 * t3 + 3.0 * t2
	var h11 := t3 - t2
	return p1 * h00 + tangent_out * h10 + p2 * h01 + tangent_in * h11
