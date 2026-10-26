class_name ParamRow
extends HBoxContainer

signal value_changed(key: String, value: float)

var key := ""
var min_value := 0.0
var max_value := 1.0
var step := 0.01
var decimals := 2
var current_value := 0.0

var _slider: HSlider
var _edit: LineEdit
var _syncing := false


func setup(
	p_key: String,
	p_label: String,
	p_min: float,
	p_max: float,
	p_step: float,
	p_value: float,
	p_decimals: int,
	p_unit: String
) -> void:
	key = p_key
	min_value = p_min
	max_value = p_max
	step = maxf(p_step, 0.0001)
	decimals = p_decimals
	current_value = clampf(p_value, min_value, max_value)
	custom_minimum_size = Vector2(0.0, 29.0)
	add_theme_constant_override("separation", 5)

	var name_label := Label.new()
	name_label.text = p_label
	name_label.custom_minimum_size = Vector2(96.0, 0.0)
	name_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 13)
	add_child(name_label)

	_slider = HSlider.new()
	_slider.min_value = min_value
	_slider.max_value = max_value
	_slider.step = step
	_slider.value = current_value
	_slider.custom_minimum_size = Vector2(88.0, 0.0)
	_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	add_child(_slider)

	_edit = LineEdit.new()
	_edit.custom_minimum_size = Vector2(58.0, 25.0)
	_edit.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_edit.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_edit.text = _format_value(current_value)
	_edit.add_theme_font_size_override("font_size", 13)
	_edit.tooltip_text = "输入数值后按 Enter；非法或越界值会自动还原到有效范围。"
	add_child(_edit)

	if p_unit != "":
		var unit_label := Label.new()
		unit_label.text = p_unit
		unit_label.custom_minimum_size = Vector2(42.0, 0.0)
		unit_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		unit_label.add_theme_font_size_override("font_size", 11)
		unit_label.add_theme_color_override("font_color", Color(0.67, 0.75, 0.82, 0.78))
		add_child(unit_label)

	_slider.value_changed.connect(_on_slider_changed)
	_edit.text_submitted.connect(_on_text_submitted)
	_edit.focus_exited.connect(_on_focus_exited)


func set_external_value(value: float) -> void:
	current_value = clampf(value, min_value, max_value)
	_syncing = true
	_slider.value = current_value
	_syncing = false
	_edit.text = _format_value(current_value)


func _on_slider_changed(value: float) -> void:
	if _syncing:
		return
	current_value = clampf(value, min_value, max_value)
	_edit.text = _format_value(current_value)
	value_changed.emit(key, current_value)


func _on_text_submitted(_text: String) -> void:
	_apply_edit_text()


func _on_focus_exited() -> void:
	_apply_edit_text()


func _apply_edit_text() -> void:
	var text := _edit.text.strip_edges()
	if not text.is_valid_float():
		_revert_edit()
		return
	var value := text.to_float()
	if is_nan(value) or is_inf(value):
		_revert_edit()
		return
	current_value = clampf(value, min_value, max_value)
	_syncing = true
	_slider.value = current_value
	_syncing = false
	_edit.text = _format_value(current_value)
	value_changed.emit(key, current_value)


func _revert_edit() -> void:
	_edit.text = _format_value(current_value)


func _format_value(value: float) -> String:
	return String.num(value, decimals)
