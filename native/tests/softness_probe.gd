extends SceneTree

const SimScript = preload("res://scripts/physics/soft_body_sim.gd")
const DT := 1.0 / 240.0
const ARENA := Rect2(24.0, 24.0, 872.0, 752.0)
const CENTER := Vector2(460.0, 400.0)
const SPAWN := Vector2(238.0, 210.0)
const RADIUS := 62.0


func _initialize() -> void:
	var sets := [
		{"name": "B", "edge": 0.35, "area": 0.35, "shape": 0.02, "bend": 0.04},
		{"name": "Bsoft", "edge": 0.30, "area": 0.30, "shape": 0.015, "bend": 0.03},
		{"name": "Bstiff", "edge": 0.45, "area": 0.45, "shape": 0.03, "bend": 0.05},
		{"name": "C", "edge": 0.25, "area": 0.25, "shape": 0.01, "bend": 0.02},
	]
	for item in sets:
		_probe_fields(item)
	_probe_grabs(sets[0])
	quit(0)


func _make(set: Dictionary, g: float, mu: float, damp: float) -> SoftBodySim:
	var s: SoftBodySim = SimScript.new()
	s.setup(ARENA, CENTER, SPAWN, RADIUS)
	s.gravity = g
	s.center_mu = mu
	s.damping = damp
	s.edge_stiffness = set["edge"]
	s.area_strength = set["area"]
	s.shape_strength = set["shape"]
	s.bending_stiffness = set["bend"]
	return s


func _deform(s: SoftBodySim) -> Dictionary:
	var mean := s.get_body_radius()
	var radial := 0.0
	var strain := 0.0
	for i in s.positions.size():
		radial = maxf(radial, absf(s.positions[i].distance_to(s.centroid) - mean) / mean)
		var edge := s.positions[i].distance_to(s.positions[(i + 1) % s.positions.size()])
		strain = maxf(strain, absf(edge - s.rest_edge_lengths[i]) / s.rest_edge_lengths[i])
	var min_x := s.positions[0].x
	var max_x := min_x
	var min_y := s.positions[0].y
	var max_y := min_y
	for p in s.positions:
		min_x = minf(min_x, p.x)
		max_x = maxf(max_x, p.x)
		min_y = minf(min_y, p.y)
		max_y = maxf(max_y, p.y)
	var width := max_x - min_x
	var height := max_y - min_y
	var aspect := maxf(width, height) / maxf(minf(width, height), 1.0)
	return {"radial": radial, "strain": strain, "aspect": aspect, "area": s.last_area_error}


func _track(s: SoftBodySim, seconds: float) -> Dictionary:
	var result := {"radial": 0.0, "strain": 0.0, "aspect": 1.0, "area": 0.0, "speed": 0.0, "contact": false}
	for _i in int(round(seconds / DT)):
		s.step(DT)
		var d := _deform(s)
		result["radial"] = maxf(result["radial"], d["radial"])
		result["strain"] = maxf(result["strain"], d["strain"])
		result["aspect"] = maxf(result["aspect"], d["aspect"])
		result["area"] = maxf(result["area"], d["area"])
		result["speed"] = maxf(result["speed"], s.last_max_speed)
		result["contact"] = result["contact"] or s.last_contact
	return result


func _probe_fields(set: Dictionary) -> void:
	var s := _make(set, 900.0, 0.0, 1.0)
	var fall := _track(s, 4.0)
	print("[fall900 %s] radial=%.3f strain=%.3f aspect=%.2f area=%.3f speed=%.0f" % [
		set["name"], fall["radial"], fall["strain"], fall["aspect"], fall["area"], fall["speed"]
	])

	s = _make(set, 0.0, 90.0e6, 1.0)
	var center := _track(s, 4.0)
	print("[center90 %s] radial=%.3f strain=%.3f aspect=%.2f area=%.3f speed=%.0f dist=%.0f" % [
		set["name"], center["radial"], center["strain"], center["aspect"], center["area"], center["speed"], s.centroid.distance_to(CENTER)
	])

	s = _make(set, 900.0, 120.0e6, 1.0)
	var dual := _track(s, 10.0)
	print("[dual %s] radial=%.3f strain=%.3f aspect=%.2f area=%.3f speed=%.0f contact=%s dist=%.0f" % [
		set["name"], dual["radial"], dual["strain"], dual["aspect"], dual["area"], dual["speed"], dual["contact"], s.centroid.distance_to(CENTER)
	])


func _probe_grabs(set: Dictionary) -> void:
	var configs := [
		{"name": "150/9000", "k": 150.0, "a": 9000.0},
		{"name": "300/18000", "k": 300.0, "a": 18000.0},
		{"name": "600/30000", "k": 600.0, "a": 30000.0},
	]
	for cfg in configs:
		var s := _make(set, 0.0, 0.0, 0.5)
		s.grab_stiffness = cfg["k"]
		s.grab_max_accel = cfg["a"]
		var top := SPAWN + Vector2(0.0, -RADIUS)
		s.grab_at(top, 40.0)
		var index := s.grab_index
		s.update_grab(top + Vector2(200.0, -50.0))
		var values := _track(s, 0.45)
		var travelled := 0.0
		if index >= 0:
			travelled = s.positions[index].distance_to(top)
		print("[grab %s %s] radial=%.3f strain=%.3f aspect=%.2f travel=%.0f speed=%.0f" % [
			set["name"], cfg["name"], values["radial"], values["strain"], values["aspect"], travelled, values["speed"]
		])
