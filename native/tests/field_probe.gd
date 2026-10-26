extends SceneTree

const SimScript = preload("res://scripts/physics/soft_body_sim.gd")
const DT := 1.0 / 240.0
const ARENA := Rect2(24.0, 24.0, 872.0, 752.0)
const CENTER := Vector2(460.0, 400.0)
const SPAWN := Vector2(238.0, 210.0)
const RADIUS := 62.0


func _initialize() -> void:
	var scenarios := [
		{"name": "mu60 d0.4", "g": 900.0, "mu": 60.0e6, "d": 0.4},
		{"name": "mu75 d0.4", "g": 900.0, "mu": 75.0e6, "d": 0.4},
		{"name": "mu90 d0.4", "g": 900.0, "mu": 90.0e6, "d": 0.4},
		{"name": "mu75 d0.6", "g": 900.0, "mu": 75.0e6, "d": 0.6},
		{"name": "g700 mu75 d0.5", "g": 700.0, "mu": 75.0e6, "d": 0.5},
		{"name": "g800 mu75 d0.6", "g": 800.0, "mu": 75.0e6, "d": 0.6},
	]
	for sc in scenarios:
		_probe_dual(sc)
	for mu in [75.0e6, 90.0e6]:
		_probe_center(mu)
	quit(0)


func _make(g: float, mu: float, damp: float) -> SoftBodySim:
	var s: SoftBodySim = SimScript.new()
	s.setup(ARENA, CENTER, SPAWN, RADIUS)
	s.gravity = g
	s.center_mu = mu
	s.damping = damp
	s.edge_stiffness = 0.35
	s.area_strength = 0.35
	s.shape_strength = 0.02
	s.bending_stiffness = 0.04
	return s


func _track(s: SoftBodySim, seconds: float) -> Dictionary:
	var result := {"radial": 0.0, "strain": 0.0, "aspect": 1.0, "area": 0.0, "speed": 0.0, "contact": false, "contact_steps": 0, "min_dist": 1.0e9, "travel": 0.0}
	var last := s.centroid
	for _i in int(round(seconds / DT)):
		s.step(DT)
		var mean := s.get_body_radius()
		for i in s.positions.size():
			result["radial"] = maxf(result["radial"], absf(s.positions[i].distance_to(s.centroid) - mean) / mean)
			var edge := s.positions[i].distance_to(s.positions[(i + 1) % s.positions.size()])
			result["strain"] = maxf(result["strain"], absf(edge - s.rest_edge_lengths[i]) / s.rest_edge_lengths[i])
		var min_x := s.positions[0].x
		var max_x := min_x
		var min_y := s.positions[0].y
		var max_y := min_y
		for p in s.positions:
			min_x = minf(min_x, p.x)
			max_x = maxf(max_x, p.x)
			min_y = minf(min_y, p.y)
			max_y = maxf(max_y, p.y)
		result["aspect"] = maxf(result["aspect"], maxf(max_x - min_x, max_y - min_y) / maxf(minf(max_x - min_x, max_y - min_y), 1.0))
		result["area"] = maxf(result["area"], s.last_area_error)
		result["speed"] = maxf(result["speed"], s.last_max_speed)
		result["contact"] = result["contact"] or s.last_contact
		if s.last_contact:
			result["contact_steps"] += 1
		result["min_dist"] = minf(result["min_dist"], s.centroid.distance_to(CENTER))
		result["travel"] += s.centroid.distance_to(last)
		last = s.centroid
	return result


func _probe_dual(sc: Dictionary) -> void:
	var s := _make(sc["g"], sc["mu"], sc["d"])
	var v := _track(s, 12.0)
	print("[dual %s] radial=%.3f strain=%.3f aspect=%.2f area=%.3f speed=%.0f contact_steps=%d travel=%.0f min_d=%.0f end_d=%.0f end_speed=%.0f" % [
		sc["name"], v["radial"], v["strain"], v["aspect"], v["area"], v["speed"], v["contact_steps"],
		v["travel"], v["min_dist"], s.centroid.distance_to(CENTER), s.last_max_speed
	])


func _probe_center(mu: float) -> void:
	var s := _make(0.0, mu, 0.4)
	var v := _track(s, 8.0)
	print("[center %.0fM] radial=%.3f strain=%.3f aspect=%.2f speed=%.0f contact_steps=%d travel=%.0f min_d=%.0f end_d=%.0f end_speed=%.0f" % [
		mu / 1.0e6, v["radial"], v["strain"], v["aspect"], v["speed"], v["contact_steps"],
		v["travel"], v["min_dist"], s.centroid.distance_to(CENTER), s.last_max_speed
	])
