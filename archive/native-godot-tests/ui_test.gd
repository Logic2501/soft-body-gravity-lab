extends SceneTree

## Headless UI smoke test for the live parameter panel.

const PanelScript = preload("res://scripts/ui/control_panel.gd")

var _failures: Array[String] = []


func _initialize() -> void:
	var panel = PanelScript.new()
	root.add_child(panel)
	panel.setup({
		"gravity": 900.0,
		"center_mu": 90.0,
		"edge_stiffness": 0.35,
		"area_strength": 0.35,
		"shape_strength": 0.02,
		"damping": 0.4,
		"restitution": 0.45,
		"wall_friction": 0.12,
	})

	var rows: Dictionary = panel.get("_rows")
	_expect(rows.size() == 8, "ui: all 8 parameter rows should be built")

	var emitted: Array = []
	panel.param_changed.connect(func(key: String, value: float) -> void: emitted.append([key, value]))

	var gravity_row = rows["gravity"]
	var slider: HSlider = gravity_row.get("_slider")
	var edit: LineEdit = gravity_row.get("_edit")

	# Programmatic `value =` does not emit in Godot 4.7; a real slider drag does.
	# Emit directly to exercise the same signal path that the drag uses.
	slider.value = 1200.0
	slider.value_changed.emit(1200.0)
	_expect(absf(gravity_row.current_value - 1200.0) < 0.001, "ui: slider should update the model value")
	_expect(edit.text == "1200", "ui: slider should update the numeric field")
	_expect(emitted.size() == 1 and emitted[0][0] == "gravity", "ui: slider change should emit a parameter signal")

	edit.text = "1500"
	gravity_row.call("_apply_edit_text")
	_expect(absf(gravity_row.current_value - 1500.0) < 0.001, "ui: valid numeric input should be applied")
	_expect(absf(slider.value - 1500.0) < 0.001, "ui: numeric input should update the slider")

	edit.text = "not-a-number"
	gravity_row.call("_apply_edit_text")
	_expect(absf(gravity_row.current_value - 1500.0) < 0.001, "ui: invalid input should be rejected")
	_expect(edit.text == "1500", "ui: invalid input should revert the text")

	edit.text = "99999"
	gravity_row.call("_apply_edit_text")
	_expect(absf(gravity_row.current_value - 2500.0) < 0.001, "ui: out-of-range input should clamp")
	_expect(edit.text == "2500", "ui: clamped value should be shown")

	var paused_signals: Array = []
	panel.pause_toggled.connect(func(paused: bool) -> void: paused_signals.append(paused))
	panel.call("_on_pause_pressed")
	_expect(paused_signals.size() == 1 and paused_signals[0] == true, "ui: pause button should emit paused state")
	_expect(panel.get("_paused") == true, "ui: pause state should be tracked")
	panel.set_paused(false)

	var reset_count: Array = [0]
	panel.reset_requested.connect(func() -> void: reset_count[0] += 1)
	panel.call("_on_reset_pressed")
	_expect(reset_count[0] == 1, "ui: reset button should emit reset signal")

	var debug_states: Array = []
	panel.debug_toggled.connect(func(enabled: bool) -> void: debug_states.append(enabled))
	var debug_check: CheckBox = panel.get("_debug_check")
	debug_check.button_pressed = true
	_expect(debug_states.size() == 1 and debug_states[0] == true, "ui: debug checkbox should emit its state")

	panel.call("_on_defaults_pressed")
	_expect(absf(gravity_row.current_value - 900.0) < 0.001, "ui: restore defaults should restore gravity")
	_expect(edit.text == "900", "ui: restore defaults should refresh the numeric field")

	if _failures.is_empty():
		print("RESULT: PASS — UI smoke checks passed")
		quit(0)
	else:
		for failure in _failures:
			print("FAIL: " + failure)
		print("RESULT: FAIL — %d UI check(s) failed" % _failures.size())
		quit(1)


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
