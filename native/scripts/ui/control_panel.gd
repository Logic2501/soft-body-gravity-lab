class_name ControlPanel
extends CanvasLayer

signal param_changed(key: String, value: float)
signal pause_toggled(paused: bool)
signal reset_requested
signal defaults_requested
signal debug_toggled(enabled: bool)

const PANEL_WIDTH := 368.0

const PARAM_DEFS := [
	{"key": "gravity", "label": "重力强度", "min": 0.0, "max": 2500.0, "step": 10.0, "decimals": 0, "unit": "px/s²"},
	{"key": "center_mu", "label": "中心引力 μ", "min": 0.0, "max": 250.0, "step": 1.0, "decimals": 0, "unit": "×10⁶"},
	{"key": "edge_stiffness", "label": "边缘刚度", "min": 0.05, "max": 1.0, "step": 0.01, "decimals": 2, "unit": ""},
	{"key": "area_strength", "label": "面积保持", "min": 0.0, "max": 1.0, "step": 0.01, "decimals": 2, "unit": ""},
	{"key": "shape_strength", "label": "形状保持", "min": 0.0, "max": 0.6, "step": 0.01, "decimals": 2, "unit": ""},
	{"key": "damping", "label": "阻尼", "min": 0.0, "max": 8.0, "step": 0.1, "decimals": 1, "unit": "1/s"},
	{"key": "restitution", "label": "边界恢复", "min": 0.0, "max": 1.0, "step": 0.01, "decimals": 2, "unit": ""},
	{"key": "wall_friction", "label": "边界摩擦", "min": 0.0, "max": 1.0, "step": 0.01, "decimals": 2, "unit": ""},
]

var _rows := {}
var _defaults := {}
var _paused := false
var _pause_button: Button
var _status_label: Label
var _metrics_label: Label
var _debug_check: CheckBox


func setup(current_values: Dictionary) -> void:
	_defaults = current_values.duplicate()
	_build(current_values)
	set_paused(false)


func _build(current_values: Dictionary) -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	panel.offset_left = -PANEL_WIDTH
	panel.offset_right = 0.0
	panel.offset_top = 0.0
	panel.offset_bottom = 0.0
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.add_theme_stylebox_override("panel", _make_panel_style())
	root.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 18)
	margin.add_theme_constant_override("margin_right", 18)
	margin.add_theme_constant_override("margin_top", 16)
	margin.add_theme_constant_override("margin_bottom", 16)
	panel.add_child(margin)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	margin.add_child(column)

	var title := Label.new()
	title.text = "软体引力实验"
	title.add_theme_font_size_override("font_size", 22)
	title.add_theme_color_override("font_color", Color(0.78, 1.0, 0.91, 1.0))
	column.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "质点环 · PBD 约束 · 固定 240 Hz"
	subtitle.add_theme_font_size_override("font_size", 12)
	subtitle.add_theme_color_override("font_color", Color(0.62, 0.74, 0.82, 0.86))
	column.add_child(subtitle)

	_status_label = Label.new()
	_status_label.add_theme_font_size_override("font_size", 13)
	_status_label.add_theme_color_override("font_color", Color(0.58, 0.95, 0.78, 1.0))
	column.add_child(_status_label)

	column.add_child(HSeparator.new())

	for definition in PARAM_DEFS:
		var key: String = definition["key"]
		var row := ParamRow.new()
		row.setup(
			key,
			definition["label"],
			definition["min"],
			definition["max"],
			definition["step"],
			current_values[key],
			definition["decimals"],
			definition["unit"]
		)
		row.value_changed.connect(_on_row_changed)
		column.add_child(row)
		_rows[key] = row

	column.add_child(HSeparator.new())

	var action_row := HBoxContainer.new()
	action_row.add_theme_constant_override("separation", 8)
	column.add_child(action_row)

	_pause_button = Button.new()
	_pause_button.text = "暂停"
	_pause_button.custom_minimum_size = Vector2(0.0, 32.0)
	_pause_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pause_button.pressed.connect(_on_pause_pressed)
	action_row.add_child(_pause_button)

	var reset_button := Button.new()
	reset_button.text = "重置实验"
	reset_button.custom_minimum_size = Vector2(0.0, 32.0)
	reset_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	reset_button.pressed.connect(_on_reset_pressed)
	action_row.add_child(reset_button)

	var defaults_button := Button.new()
	defaults_button.text = "恢复推荐参数"
	defaults_button.custom_minimum_size = Vector2(0.0, 30.0)
	defaults_button.pressed.connect(_on_defaults_pressed)
	column.add_child(defaults_button)

	_debug_check = CheckBox.new()
	_debug_check.text = "显示质点与弹簧"
	_debug_check.add_theme_font_size_override("font_size", 13)
	_debug_check.toggled.connect(_on_debug_toggled)
	column.add_child(_debug_check)

	_metrics_label = Label.new()
	_metrics_label.text = "最大速度 — · 面积误差 —"
	_metrics_label.add_theme_font_size_override("font_size", 12)
	_metrics_label.add_theme_color_override("font_color", Color(0.72, 0.80, 0.86, 0.88))
	_metrics_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(_metrics_label)

	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(spacer)

	var hint := Label.new()
	hint.text = "拖动软体轮廓：对最近质点施加有限拖拽力\n松开后恢复纯物理模拟\n空格 暂停/继续 · R 重置\n数值框支持精确输入，非法值自动还原"
	hint.add_theme_font_size_override("font_size", 11)
	hint.add_theme_color_override("font_color", Color(0.64, 0.72, 0.78, 0.70))
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(hint)


func _make_panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.045, 0.058, 0.088, 0.98)
	style.border_width_left = 1
	style.border_color = Color(0.20, 0.32, 0.38, 0.55)
	style.corner_radius_top_left = 10
	style.corner_radius_bottom_left = 10
	return style


func _on_row_changed(key: String, value: float) -> void:
	param_changed.emit(key, value)


func _on_pause_pressed() -> void:
	set_paused(not _paused)
	pause_toggled.emit(_paused)


func _on_reset_pressed() -> void:
	reset_requested.emit()


func _on_defaults_pressed() -> void:
	for definition in PARAM_DEFS:
		var key: String = definition["key"]
		var row: ParamRow = _rows[key]
		var value: float = _defaults[key]
		row.set_external_value(value)
		param_changed.emit(key, value)
	defaults_requested.emit()


func _on_debug_toggled(enabled: bool) -> void:
	debug_toggled.emit(enabled)


func set_paused(paused: bool) -> void:
	_paused = paused
	if _pause_button != null:
		_pause_button.text = "继续" if paused else "暂停"
	if _status_label != null:
		if paused:
			_status_label.text = "已暂停 · 参数仍可实时调整"
			_status_label.add_theme_color_override("font_color", Color(0.98, 0.78, 0.36, 1.0))
		else:
			_status_label.text = "运行中 · 重力 + 中心引力"
			_status_label.add_theme_color_override("font_color", Color(0.58, 0.95, 0.78, 1.0))


func set_metrics(max_speed: float, area_error: float, contact: bool) -> void:
	if _metrics_label == null:
		return
	var contact_text := " · 接触边界" if contact else ""
	_metrics_label.text = "最大速度 %d px/s\n面积误差 %.1f%%%s" % [roundi(max_speed), area_error * 100.0, contact_text]
