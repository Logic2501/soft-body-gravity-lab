extends SceneTree

## Headless numerical acceptance tests for the soft-body solver.
## Run: .tools/Godot.app/Contents/MacOS/Godot --headless --path . --script res://tests/physics_test.gd

const SimScript = preload("res://scripts/physics/soft_body_sim.gd")

const DT := 1.0 / 240.0
const ARENA := Rect2(24.0, 24.0, 872.0, 752.0)
const CENTER := Vector2(460.0, 400.0)
const SPAWN := Vector2(238.0, 210.0)
const RADIUS := 62.0

var _failures: Array[String] = []


func _initialize() -> void:
	_test_free_fall()
	_test_center_only()
	_test_center_near_singularity()
	_test_dual_field()
	_test_boundary_bounce()
	_test_long_stability()
	_test_repeatability_and_reset()
	_test_local_grab()
	_test_extreme_parameters()

	if _failures.is_empty():
		print("RESULT: PASS — all numerical checks passed")
		quit(0)
	else:
		for failure in _failures:
			print("FAIL: " + failure)
		print("RESULT: FAIL — %d check(s) failed" % _failures.size())
		quit(1)


func _make_sim(gravity_value := 900.0, center_mu_value := 90.0e6, damping_value := 0.4) -> SoftBodySim:
	var sim: SoftBodySim = SimScript.new()
	sim.setup(ARENA, CENTER, SPAWN, RADIUS)
	sim.gravity = gravity_value
	sim.center_mu = center_mu_value
	sim.damping = damping_value
	return sim


func _run(sim: SoftBodySim, seconds: float) -> Dictionary:
	var steps := int(round(seconds / DT))
	var stats := {
		"inside": true,
		"finite": true,
		"max_speed": 0.0,
		"max_area_error": 0.0,
		"min_area_ratio": 1.0,
		"max_center_accel": 0.0,
		"contact": false,
		"penetration": 0.0,
		"max_radial_dev": 0.0,
		"max_edge_strain": 0.0,
		"max_aspect": 1.0,
		"orientation_flips": 0,
	}
	for _i in steps:
		sim.step(DT)
		stats["max_speed"] = maxf(stats["max_speed"], sim.last_max_speed)
		stats["max_area_error"] = maxf(stats["max_area_error"], sim.last_area_error)
		stats["min_area_ratio"] = minf(stats["min_area_ratio"], 1.0 - sim.last_area_error)
		stats["max_center_accel"] = maxf(stats["max_center_accel"], sim.last_max_center_accel)
		stats["contact"] = stats["contact"] or sim.last_contact
		if _polygon_area(sim.positions) * sim.rest_area < 0.0:
			stats["orientation_flips"] += 1
		var mean_radius := sim.get_body_radius()
		for i in sim.positions.size():
			var radial := sim.positions[i].distance_to(sim.centroid)
			stats["max_radial_dev"] = maxf(stats["max_radial_dev"], absf(radial - mean_radius) / maxf(mean_radius, 1.0))
			var edge_length := sim.positions[i].distance_to(sim.positions[(i + 1) % sim.positions.size()])
			stats["max_edge_strain"] = maxf(stats["max_edge_strain"], absf(edge_length - sim.rest_edge_lengths[i]) / maxf(sim.rest_edge_lengths[i], 1.0))
		var min_x := sim.positions[0].x
		var max_x := sim.positions[0].x
		var min_y := sim.positions[0].y
		var max_y := sim.positions[0].y
		for p in sim.positions:
			min_x = minf(min_x, p.x); max_x = maxf(max_x, p.x)
			min_y = minf(min_y, p.y); max_y = maxf(max_y, p.y)
		var width := max_x - min_x
		var height := max_y - min_y
		if width > 1.0 and height > 1.0:
			stats["max_aspect"] = maxf(stats["max_aspect"], maxf(width, height) / minf(width, height))
		if sim.last_instability:
			stats["finite"] = false
		for p in sim.positions:
			if not _finite(p):
				stats["finite"] = false
			var penetration := maxf(
				maxf(ARENA.position.x - p.x, p.x - ARENA.end.x),
				maxf(ARENA.position.y - p.y, p.y - ARENA.end.y)
			)
			stats["penetration"] = maxf(stats["penetration"], penetration)
			if penetration > 0.05:
				stats["inside"] = false
	return stats


func _test_free_fall() -> void:
	var sim := _make_sim(900.0, 0.0)
	var start_y := sim.centroid.y
	var stats := _run(sim, 1.0)
	var one_second_y := sim.centroid.y
	stats = _run(sim, 3.0)
	print("[free fall] centroid_y %.1f -> %.1f after 1s; 4s stats speed=%.1f area_err=%.3f penetration=%.3f contact=%s" % [
		start_y, one_second_y, stats["max_speed"], stats["max_area_error"], stats["penetration"], stats["contact"]
	])
	_expect(one_second_y > start_y + 250.0, "free fall: body should move down clearly")
	_expect(stats["inside"], "free fall: points must stay inside the arena")
	_expect(stats["finite"], "free fall: no NaN/instability")
	_expect(stats["contact"], "free fall: body should reach and touch the floor")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "free fall: speed cap respected")


func _test_center_only() -> void:
	var sim := _make_sim(0.0, 90.0e6)
	var start_distance := sim.centroid.distance_to(CENTER)
	var stats := _run(sim, 1.2)
	var after_distance := sim.centroid.distance_to(CENTER)
	stats = _run(sim, 4.0)
	print("[center only] distance %.1f -> %.1f after 1.2s; stats speed=%.1f area_err=%.3f min_area=%.2f center_accel=%.0f" % [
		start_distance, after_distance, stats["max_speed"], stats["max_area_error"], stats["min_area_ratio"], stats["max_center_accel"]
	])
	_expect(after_distance < start_distance - 60.0, "center gravity: body should be pulled toward the source")
	_expect(stats["inside"], "center gravity: points must stay inside the arena")
	_expect(stats["finite"], "center gravity: no NaN/instability")
	_expect(stats["min_area_ratio"] > 0.35, "center gravity: body must not collapse")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "center gravity: speed cap respected")


func _test_center_near_singularity() -> void:
	var sim: SoftBodySim = SimScript.new()
	sim.setup(ARENA, CENTER, CENTER, RADIUS)
	sim.gravity = 0.0
	sim.center_mu = 250.0e6
	var stats := _run(sim, 6.0)
	print("[near center] speed=%.1f area_err=%.3f min_area=%.2f center_accel=%.0f penetration=%.3f" % [
		stats["max_speed"], stats["max_area_error"], stats["min_area_ratio"], stats["max_center_accel"], stats["penetration"]
	])
	_expect(stats["finite"], "near singularity: no NaN/instability")
	_expect(stats["inside"], "near singularity: points must stay inside the arena")
	_expect(stats["max_center_accel"] <= 9000.1, "near singularity: center acceleration must stay capped")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "near singularity: speed cap respected")
	_expect(stats["min_area_ratio"] > 0.30, "near singularity: body must not collapse")


func _test_dual_field() -> void:
	var sim := _make_sim()
	var stats := _run(sim, 8.0)
	print("[dual field] speed=%.1f area_err=%.3f min_area=%.2f radial_dev=%.3f edge_strain=%.3f aspect=%.2f contact=%s" % [
		stats["max_speed"], stats["max_area_error"], stats["min_area_ratio"], stats["max_radial_dev"], stats["max_edge_strain"], stats["max_aspect"], stats["contact"]
	])
	_expect(stats["inside"], "dual field: points must stay inside the arena")
	_expect(stats["finite"], "dual field: no NaN/instability")
	_expect(stats["min_area_ratio"] > 0.35, "dual field: body must not collapse")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "dual field: speed cap respected")
	_expect(stats["orientation_flips"] == 0, "dual field: contour orientation must not flip")


func _test_boundary_bounce() -> void:
	var sim := _make_sim(1600.0, 0.0, 0.25)
	sim.restitution = 0.9
	var contact_y := 0.0
	var found_contact := false
	for _i in int(round(2.5 / DT)):
		sim.step(DT)
		if sim.last_contact and not found_contact:
			found_contact = true
			contact_y = sim.centroid.y
			break
	var min_y_after := sim.centroid.y
	for _i in int(round(0.55 / DT)):
		sim.step(DT)
		min_y_after = minf(min_y_after, sim.centroid.y)
	print("[boundary] contact=%s contact_y=%.1f min_y_after=%.1f rebound=%.1f" % [
		found_contact, contact_y, min_y_after, contact_y - min_y_after
	])
	_expect(found_contact, "boundary: body should contact the floor")
	_expect(contact_y - min_y_after > 25.0, "boundary: high restitution should visibly rebound")
	var stats := _run(sim, 2.0)
	_expect(stats["inside"], "boundary: no penetration after bounce")
	_expect(stats["finite"], "boundary: no NaN/instability")


func _test_long_stability() -> void:
	var sim := _make_sim()
	var stats := _run(sim, 20.0)
	print("[stability 20s] speed=%.1f area_err=%.3f min_area=%.2f radial_dev=%.3f edge_strain=%.3f aspect=%.2f" % [
		stats["max_speed"], stats["max_area_error"], stats["min_area_ratio"], stats["max_radial_dev"], stats["max_edge_strain"], stats["max_aspect"]
	])
	_expect(stats["finite"], "stability: no NaN/instability over 20s")
	_expect(stats["inside"], "stability: no wall penetration over 20s")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "stability: speed cap respected over 20s")
	_expect(stats["min_area_ratio"] > 0.30, "stability: area must remain bounded over 20s")
	_expect(stats["orientation_flips"] == 0, "stability: contour orientation must not flip over 20s")


func _test_repeatability_and_reset() -> void:
	var a := _make_sim()
	var b := _make_sim()
	var steps := int(round(3.0 / DT))
	for _i in steps:
		a.step(DT)
		b.step(DT)
	var max_diff := 0.0
	for i in a.positions.size():
		max_diff = maxf(max_diff, a.positions[i].distance_to(b.positions[i]))
	print("[repeatability] max position diff after 3s = %.9f" % max_diff)
	_expect(max_diff < 1.0e-6, "repeatability: identical initial state must produce identical motion")

	a.reset()
	var reset_diff := 0.0
	for i in a.positions.size():
		reset_diff = maxf(reset_diff, a.positions[i].distance_to(a.initial_positions[i]))
	var max_reset_speed := 0.0
	for v in a.velocities:
		max_reset_speed = maxf(max_reset_speed, v.length())
	print("[reset] reset position diff=%.9f reset speed=%.9f" % [reset_diff, max_reset_speed])
	_expect(reset_diff < 1.0e-9, "reset: positions must return to initial state")
	_expect(max_reset_speed < 1.0e-9, "reset: velocities must be zero")


func _test_local_grab() -> void:
	var sim := _make_sim(0.0, 0.0, 0.5)
	var top := SPAWN + Vector2(0.0, -RADIUS)
	var grabbed := sim.grab_at(top, 40.0)
	_expect(grabbed, "grab: nearest perimeter point should be selected")
	if not grabbed:
		return
	var index := sim.grab_index
	var start := sim.positions[index]
	sim.update_grab(top + Vector2(200.0, -50.0))
	for _i in int(round(0.45 / DT)):
		sim.step(DT)
	var travelled := sim.positions[index].distance_to(start)
	var held_speed := sim.velocities[index].length()
	sim.release_grab()
	var stats := _run(sim, 1.5)
	print("[grab] travelled=%.1f held_speed=%.1f post-release speed=%.1f area_err=%.3f" % [
		travelled, held_speed, stats["max_speed"], stats["max_area_error"]
	])
	_expect(travelled > 30.0, "grab: dragged point should move")
	_expect(held_speed <= sim.max_speed + 0.5, "grab: drag force must respect speed cap")
	_expect(stats["finite"], "grab: release should remain stable")
	_expect(stats["inside"], "grab: release must not tunnel through walls")


func _test_extreme_parameters() -> void:
	var sim := _make_sim(2500.0, 250.0e6, 0.0)
	sim.edge_stiffness = 0.05
	sim.area_strength = 0.0
	sim.shape_strength = 0.0
	sim.bending_stiffness = 0.0
	sim.restitution = 1.0
	sim.wall_friction = 0.0
	sim.max_speed = 2600.0
	var stats := _run(sim, 20.0)
	print("[extreme] speed=%.1f area_err=%.3f min_area=%.2f penetration=%.3f flips=%d" % [
		stats["max_speed"], stats["max_area_error"], stats["min_area_ratio"], stats["penetration"], stats["orientation_flips"]
	])
	_expect(stats["finite"], "extreme: no NaN/instability at maximum field strengths")
	_expect(stats["inside"], "extreme: points must stay inside the arena")
	_expect(stats["max_speed"] <= sim.max_speed + 0.5, "extreme: speed cap respected")
	_expect(stats["max_center_accel"] <= 9000.1, "extreme: center acceleration cap respected")


func _polygon_area(points: PackedVector2Array) -> float:
	var total := 0.0
	for i in points.size():
		var a := points[i]
		var b := points[(i + 1) % points.size()]
		total += a.x * b.y - b.x * a.y
	return total * 0.5


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)


func _finite(v: Vector2) -> bool:
	return not is_nan(v.x) and not is_inf(v.x) and not is_nan(v.y) and not is_inf(v.y)
