"""Harbor agent adapter for mi."""

__all__ = ["MiAgent"]


def __getattr__(name):
    if name == "MiAgent":
        from .mi_agent import MiAgent

        return MiAgent
    raise AttributeError(name)
