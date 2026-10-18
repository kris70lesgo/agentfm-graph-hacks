"""Short, dimensional explainer for Warp's FalkorDB routing and memory flow."""
from manimlib import *

config.frame_width = 16
config.frame_height = 9
config.background_color = "#101216"

INK = "#101216"
WHITE = "#F6F5F1"
MUTED = "#A6AFB9"
AMBER = "#FFB547"
TEAL = "#58D5AA"
BLUE = "#83B7FF"
GRID = "#242A32"


def sphere(point, color, radius=0.22):
    return Sphere(radius=radius, resolution=(20, 12)).move_to(point).set_color(color)


class WarpGraphExplainer(ThreeDScene):
    def construct(self):
        frame = self.camera.frame
        frame.reorient(-20, 68, height=7.6)
        frame.set_focal_distance(18)

        brand = Text("WARP   ×   FALKORDB", font="DejaVu Sans", font_size=17,
                     color=AMBER, weight="BOLD").to_corner(UL, buff=0.45).fix_in_frame()
        track = Text("CONNECTED DATA  /  SHARED MEMORY", font="DejaVu Sans",
                     font_size=12, color=MUTED).to_corner(UR, buff=0.45).fix_in_frame()
        footer = Text("One graph helps every coordinator choose, coordinate, and remember.",
                      font="DejaVu Sans", font_size=17, color=WHITE).to_edge(DOWN, buff=0.4).fix_in_frame()
        self.add(brand, track)

        # A sparse, shallow star field gives the camera motion visible parallax.
        stars = Group(*[
            Sphere(radius=0.018, resolution=(8, 4), color=GRID).move_to([x, y, z])
            for x, y, z in [
                (-6.5, 2.8, -2), (-5.2, -2.8, 1.6), (-3.2, 3.2, -1),
                (-1.8, -3.0, 2), (0.2, 3.1, 1.8), (1.4, -3.2, -1.5),
                (3.9, 3.0, -2), (5.2, -2.7, 1.4), (6.5, 1.8, 0.6),
            ]
        ])
        self.add(stars)

        points = {
            "boss_a": np.array([-4.6, 1.25, 0.15]),
            "boss_b": np.array([-4.6, -1.25, -0.15]),
            "graph": np.array([-0.65, 0, 0]),
            "nova": np.array([3.1, 1.55, 1.25]),
            "atlas": np.array([3.1, -1.55, -1.25]),
            "memory": np.array([0.2, 0, -1.75]),
            "capability": np.array([5.6, 0, 0]),
        }
        colors = {
            "boss_a": AMBER, "boss_b": BLUE, "graph": AMBER,
            "nova": TEAL, "atlas": TEAL, "memory": BLUE, "capability": BLUE,
        }
        radii = {"graph": 0.46, "boss_a": 0.31, "boss_b": 0.31,
                 "nova": 0.38, "atlas": 0.34, "memory": 0.32, "capability": 0.28}
        nodes = {key: sphere(point, colors[key], radii[key]) for key, point in points.items()}

        relationships = [
            ("boss_a", "graph", AMBER), ("boss_b", "graph", BLUE),
            ("graph", "nova", TEAL), ("graph", "atlas", MUTED),
            ("nova", "capability", BLUE), ("atlas", "capability", BLUE),
            ("nova", "memory", TEAL), ("atlas", "memory", TEAL),
            ("boss_a", "boss_b", BLUE),
        ]
        edges = Group(*[
            Line3D(points[a], points[b], width=0.035, color=color).set_opacity(0.62)
            for a, b, color in relationships
        ])

        headline = Text("A mesh can learn together.", font="DejaVu Sans", font_size=37,
                        color=WHITE, weight="BOLD").move_to(UP * 2.7).fix_in_frame()
        self.play(FadeIn(headline, shift=UP * 0.1), run_time=0.6)
        self.play(LaggedStart(*[FadeIn(nodes[k], scale=0.6) for k in
                                ("graph", "boss_a", "boss_b", "nova", "atlas", "capability", "memory")],
                              lag_ratio=0.08), run_time=1.4)
        self.play(LaggedStart(*[FadeIn(edge) for edge in edges], lag_ratio=0.06),
                  frame.animate.reorient(16, 66, height=7.6), run_time=1.4)
        legend = VGroup(
            Text("BOSS NODES", font="DejaVu Sans", font_size=14, color=AMBER, weight="BOLD"),
            Text("FALKORDB GRAPH", font="DejaVu Sans", font_size=14, color=WHITE, weight="BOLD"),
            Text("WORKERS", font="DejaVu Sans", font_size=14, color=TEAL, weight="BOLD"),
            Text("TASK MEMORY", font="DejaVu Sans", font_size=14, color=BLUE, weight="BOLD"),
        ).arrange(RIGHT, buff=0.55).move_to(UP * 3.45).fix_in_frame()
        self.play(FadeOut(headline), FadeIn(legend), run_time=0.45)

        # Rotate the camera through the graph so the depth is legible, not decorative.
        route_title = Text("01  ROUTE BY CONTEXT", font="DejaVu Sans", font_size=15,
                           color=AMBER, weight="BOLD").to_corner(DL, buff=0.45).fix_in_frame()
        route_note = Text("capability   ·   trust   ·   outcomes   ·   load", font="DejaVu Sans",
                          font_size=12, color=MUTED).next_to(route_title, UP, buff=0.12).fix_in_frame()
        self.play(FadeIn(route_title), FadeIn(route_note), run_time=0.35)

        route = Line3D(points["boss_a"], points["nova"], width=0.12, color=AMBER)
        pulse = sphere(points["boss_a"], WHITE, 0.095)
        self.play(FadeIn(route), MoveAlongPath(pulse, Line(points["boss_a"], points["nova"])),
                  nodes["nova"].animate.scale(1.28).set_color(AMBER), run_time=1.35)
        self.play(FadeOut(pulse), nodes["nova"].animate.scale(1 / 1.28).set_color(TEAL),
                  run_time=0.35)
        self.wait(1.3)

        # The reservation is represented as one shared claim seen by both Bosses.
        coord_title = Text("02  SHARE CAPACITY CLAIMS", font="DejaVu Sans", font_size=15,
                           color=TEAL, weight="BOLD").to_corner(DL, buff=0.45).fix_in_frame()
        coord_note = Text("both Boss nodes see the same in-flight reservation", font="DejaVu Sans",
                          font_size=12, color=MUTED).next_to(coord_title, UP, buff=0.12).fix_in_frame()
        reservation = Line3D(points["boss_a"], points["boss_b"], width=0.12, color=TEAL)
        halo = sphere(points["nova"], TEAL, 0.66).set_opacity(0.2)
        self.play(FadeOut(route_title), FadeOut(route_note), run_time=0.25)
        self.play(FadeIn(coord_title), FadeIn(coord_note), FadeIn(halo), FadeIn(reservation), run_time=0.4)
        self.play(nodes["boss_b"].animate.scale(1.2).set_color(TEAL),
                  nodes["nova"].animate.scale(1.15), run_time=0.5)
        self.play(nodes["boss_b"].animate.scale(1 / 1.2).set_color(BLUE),
                  nodes["nova"].animate.scale(1 / 1.15), run_time=0.45)
        self.wait(1.1)

        # A compact outcome episode travels back into persistent graph memory.
        memory_title = Text("03  REMEMBER THE OUTCOME", font="DejaVu Sans", font_size=15,
                            color=BLUE, weight="BOLD").to_corner(DL, buff=0.45).fix_in_frame()
        memory_note = Text("store a digest; keep raw prompts and responses out", font="DejaVu Sans",
                           font_size=12, color=MUTED).next_to(memory_title, UP, buff=0.12).fix_in_frame()
        episode = sphere(points["nova"], BLUE, 0.11)
        memory_edge = Line3D(points["nova"], points["memory"], width=0.105, color=BLUE)
        self.play(FadeOut(coord_title), FadeOut(coord_note), run_time=0.25)
        self.play(FadeOut(reservation), FadeOut(halo), FadeIn(memory_title), FadeIn(memory_note),
                  FadeIn(memory_edge), FadeIn(episode), run_time=0.45)
        self.play(MoveAlongPath(episode, Line(points["nova"], points["memory"])),
                  nodes["memory"].animate.scale(1.25).set_color(TEAL), run_time=1.15)
        self.play(nodes["memory"].animate.scale(1 / 1.25).set_color(BLUE), run_time=0.4)
        self.wait(1.0)

        closing = Text("Shared context. Better routes.", font="DejaVu Sans", font_size=34,
                       color=WHITE, weight="BOLD").move_to(DOWN * 2.75).fix_in_frame()
        sub = Text("WARP   ·   ONE GRAPH, MANY AGENTS", font="DejaVu Sans", font_size=15,
                   color=AMBER, weight="BOLD").next_to(closing, DOWN, buff=0.25).fix_in_frame()
        disclosure = Text("AI-GENERATED NARRATION · ELEVENLABS", font="DejaVu Sans", font_size=10,
                          color=MUTED).to_edge(DOWN, buff=0.3).fix_in_frame()
        self.play(FadeOut(memory_title), FadeOut(memory_note), FadeIn(closing, shift=UP * 0.08),
                  FadeIn(sub), FadeIn(disclosure), run_time=0.65)
        self.play(frame.animate.reorient(-12, 66, height=7.6), run_time=4.2, rate_func=smooth)
        self.wait(1.8)
