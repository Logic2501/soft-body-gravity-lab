class_name ArenaView
extends Node2D

const BACKGROUND := Color(0.03, 0.04, 0.07, 1.0)
const ARENA_FILL := Color(0.055, 0.075, 0.115, 1.0)
const GRID_COLOR := Color(0.12, 0.18, 0.25, 0.33)
const BORDER_COLOR := Color(0.36, 0.83, 0.73, 0.95)
const BORDER_GLOW := Color(0.24, 0.72, 0.66, 0.16)
const GHOST_COLOR := Color(0.62, 0.88, 0.83, 0.28)
const SOURCE_COLOR := Color(0.95, 0.78, 0.35, 1.0)
const SOURCE_GLOW := Color(1.0, 0.78, 0.30, 0.22)
const TEXT_COLOR := Color(0.78, 0.86, 0.92, 0.92)

var arena_rect := Rect2()
var source_pos := Vector2.ZERO
var initial_center := Vector2.ZERO
var initial_radius := 60.0
var _time := 0.0


func setup(p_arena: Rect2, p_source: Vector2, p_initial_center: Vector2, p_initial_radius: float) -> void:
	arena_rect = p_arena
	source_pos = p_source
	initial_center = p_initial_center
	initial_radius = p_initial_radius


func _process(delta: float) -> void:
	_time += delta
	queue_redraw()


func _draw() -> void:
	var viewport_size := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, viewport_size), BACKGROUND, true)
	draw_rect(arena_rect, ARENA_FILL, true)

	var x := arena_rect.position.x + 48.0
	while x < arena_rect.end.x:
		draw_line(Vector2(x, arena_rect.position.y), Vector2(x, arena_rect.end.y), GRID_COLOR, 1.0)
		x += 48.0
	var y := arena_rect.position.y + 48.0
	while y < arena_rect.end.y:
		draw_line(Vector2(arena_rect.position.x, y), Vector2(arena_rect.end.x, y), GRID_COLOR, 1.0)
		y += 48.0

	draw_rect(arena_rect.grow(5.0), BORDER_GLOW, false, 10.0, true)
	draw_rect(arena_rect, BORDER_COLOR, false, 2.5, true)

	_draw_initial_marker()
	_draw_gravity_arrow()
	_draw_gravity_source()
	_draw_scale_label(viewport_size)


func _draw_initial_marker() -> void:
	var segments := 40
	for i in segments:
		if i % 3 == 2:
			continue
		var a0 := TAU * float(i) / float(segments)
		var a1 := TAU * float(i + 1) / float(segments)
		draw_line(
			initial_center + Vector2(cos(a0), sin(a0)) * initial_radius,
			initial_center + Vector2(cos(a1), sin(a1)) * initial_radius,
			GHOST_COLOR,
			1.5,
			true
		)
	var font := ThemeDB.fallback_font
	draw_string(font, initial_center + Vector2(-initial_radius, initial_radius + 22.0), "初始位置", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 13, GHOST_COLOR)


func _draw_gravity_arrow() -> void:
	var start := arena_rect.position + Vector2(36.0, 110.0)
	var end := start + Vector2(0.0, 54.0)
	draw_line(start, end, TEXT_COLOR, 2.5, true)
	draw_colored_polygon(PackedVector2Array([
		end,
		end + Vector2(-6.0, -12.0),
		end + Vector2(6.0, -12.0),
	]), TEXT_COLOR)
	draw_string(ThemeDB.fallback_font, start + Vector2(12.0, 2.0), "g", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 17, TEXT_COLOR)


func _draw_gravity_source() -> void:
	var pulse := 0.5 + 0.5 * sin(_time * 2.2)
	draw_circle(source_pos, 22.0 + pulse * 5.0, Color(SOURCE_GLOW, 0.10))
	draw_circle(source_pos, 15.0 + pulse * 3.0, Color(SOURCE_GLOW, 0.20))
	draw_arc(source_pos, 13.0 + pulse * 6.0, 0.0, TAU, 48, Color(SOURCE_COLOR, 0.45), 1.5, true)
	draw_circle(source_pos, 7.0, SOURCE_COLOR)
	draw_circle(source_pos, 3.0, Color(1.0, 0.97, 0.83, 1.0))
	draw_line(source_pos + Vector2(-20.0, 0.0), source_pos + Vector2(-10.0, 0.0), Color(SOURCE_COLOR, 0.75), 1.5, true)
	draw_line(source_pos + Vector2(10.0, 0.0), source_pos + Vector2(20.0, 0.0), Color(SOURCE_COLOR, 0.75), 1.5, true)
	draw_line(source_pos + Vector2(0.0, -20.0), source_pos + Vector2(0.0, -10.0), Color(SOURCE_COLOR, 0.75), 1.5, true)
	draw_line(source_pos + Vector2(0.0, 10.0), source_pos + Vector2(0.0, 20.0), Color(SOURCE_COLOR, 0.75), 1.5, true)
	draw_string(ThemeDB.fallback_font, source_pos + Vector2(18.0, -18.0), "引力中心", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 14, SOURCE_COLOR)


func _draw_scale_label(viewport_size: Vector2) -> void:
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(arena_rect.position.x + 24.0, arena_rect.end.y - 18.0), "封闭实验区 · 240 Hz 固定步长", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 12, Color(TEXT_COLOR, 0.55))
	draw_string(font, Vector2(arena_rect.end.x - 190.0, arena_rect.position.y + 30.0), "拖动果冻轮廓施加局部力", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 12, Color(TEXT_COLOR, 0.55))
