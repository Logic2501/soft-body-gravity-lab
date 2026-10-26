extends Node2D

const ARENA_RECT := Rect2(24.0, 24.0, 872.0, 752.0)
const SPAWN_CENTER := Vector2(238.0, 210.0)
const SPAWN_RADIUS := 62.0
const METRICS_INTERVAL := 0.25

var sim: SoftBodySim
var arena_view: ArenaView
var body_view: SoftBodyView
var panel: ControlPanel

var _paused := false
var _dragging := false
var _metrics_timer := 0.0


func _ready() -> void:
	var center := ARENA_RECT.get_center()
	sim = SoftBodySim.new()
	sim.setup(ARENA_RECT, center, SPAWN_CENTER, SPAWN_RADIUS)

	arena_view = ArenaView.new()
	arena_view.setup(ARENA_RECT, center, SPAWN_CENTER, SPAWN_RADIUS)
	add_child(arena_view)

	body_view = SoftBodyView.new()
	body_view.setup(sim, ARENA_RECT)
	add_child(body_view)

	panel = ControlPanel.new()
	add_child(panel)
	panel.setup(_current_params())
	panel.param_changed.connect(_on_param_changed)
	panel.pause_toggled.connect(_on_pause_toggled)
	panel.reset_requested.connect(_on_reset_requested)
	panel.defaults_requested.connect(_on_defaults_requested)
	panel.debug_toggled.connect(_on_debug_toggled)
	_update_metrics()


func _physics_process(delta: float) -> void:
	if _paused:
		return
	if _dragging and not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_end_drag()
	sim.step(delta)
	body_view.queue_redraw()
	_metrics_timer += delta
	if _metrics_timer >= METRICS_INTERVAL:
		_metrics_timer = 0.0
		_update_metrics()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE:
			_set_paused(not _paused)
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_R:
			_on_reset_requested()
			get_viewport().set_input_as_handled()
		return

	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			if not _paused and ARENA_RECT.has_point(event.position):
				_dragging = sim.grab_at(event.position)
				if _dragging:
					body_view.queue_redraw()
					get_viewport().set_input_as_handled()
		elif _dragging:
			_end_drag()
			get_viewport().set_input_as_handled()
		return

	if event is InputEventMouseMotion and _dragging:
		sim.update_grab(event.position)
		body_view.queue_redraw()
		get_viewport().set_input_as_handled()


func _end_drag() -> void:
	sim.release_grab()
	_dragging = false
	body_view.queue_redraw()


func _set_paused(paused: bool) -> void:
	_paused = paused
	if paused:
		_end_drag()
	panel.set_paused(paused)


func _on_pause_toggled(paused: bool) -> void:
	_set_paused(paused)


func _on_reset_requested() -> void:
	_end_drag()
	sim.reset()
	_metrics_timer = 0.0
	body_view.queue_redraw()
	_update_metrics()


func _on_defaults_requested() -> void:
	body_view.queue_redraw()


func _on_debug_toggled(enabled: bool) -> void:
	body_view.debug_draw = enabled
	body_view.queue_redraw()


func _on_param_changed(key: String, value: float) -> void:
	match key:
		"gravity":
			sim.gravity = value
		"center_mu":
			sim.center_mu = value * 1.0e6
		"edge_stiffness":
			sim.edge_stiffness = value
		"area_strength":
			sim.area_strength = value
		"shape_strength":
			sim.shape_strength = value
		"damping":
			sim.damping = value
		"restitution":
			sim.restitution = value
		"wall_friction":
			sim.wall_friction = value
	body_view.queue_redraw()


func _update_metrics() -> void:
	if panel != null:
		panel.set_metrics(sim.last_max_speed, sim.last_area_error, sim.last_contact)


func _current_params() -> Dictionary:
	return {
		"gravity": sim.gravity,
		"center_mu": sim.center_mu / 1.0e6,
		"edge_stiffness": sim.edge_stiffness,
		"area_strength": sim.area_strength,
		"shape_strength": sim.shape_strength,
		"damping": sim.damping,
		"restitution": sim.restitution,
		"wall_friction": sim.wall_friction,
	}
