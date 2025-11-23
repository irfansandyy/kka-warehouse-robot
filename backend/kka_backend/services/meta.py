def snapshot_meta(
    width: int,
    height: int,
    num_robots: int,
    num_tasks: int,
    num_moving: int,
    seed,
    density: float,
) -> dict:
    return {
        "width": width,
        "height": height,
        "num_robots": num_robots,
        "num_tasks": num_tasks,
        "num_moving": num_moving,
        "seed": seed,
        "wall_density": density,
    }
