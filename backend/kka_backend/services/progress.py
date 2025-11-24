import threading
import time
import uuid
from typing import Any, Dict, Optional


class ProgressRegistry:
    """In-memory tracker for long running operations."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._store: Dict[str, Dict[str, Any]] = {}

    def create(self, action: str, label: Optional[str] = None) -> Dict[str, Any]:
        job_id = uuid.uuid4().hex
        entry = {
            "id": job_id,
            "action": action,
            "label": label or action,
            "message": "Starting",
            "percent": 0,
            "status": "running",
            "error": None,
            "payload": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        with self._lock:
            self._store[job_id] = entry
        return entry.copy()

    def update(
        self,
        job_id: Optional[str],
        *,
        message: Optional[str] = None,
        percent: Optional[float] = None,
        status: Optional[str] = None,
        payload: Optional[Any] = None,
        error: Optional[str] = None,
    ) -> None:
        if not job_id:
            return
        with self._lock:
            entry = self._store.get(job_id)
            if not entry:
                return
            if message is not None:
                entry["message"] = message
            if percent is not None:
                entry["percent"] = max(0, min(100, float(percent)))
            if status is not None:
                entry["status"] = status
            if payload is not None:
                entry["payload"] = payload
            if error is not None:
                entry["error"] = error
            entry["updated_at"] = time.time()

    def complete(self, job_id: Optional[str], payload: Optional[Any] = None, message: Optional[str] = None) -> None:
        if not job_id:
            return
        with self._lock:
            entry = self._store.get(job_id)
            if not entry:
                return
            entry["percent"] = 100
            entry["status"] = "success"
            if message is not None:
                entry["message"] = message
            if payload is not None:
                entry["payload"] = payload
            entry["updated_at"] = time.time()

    def fail(self, job_id: Optional[str], error: str) -> None:
        if not job_id:
            return
        with self._lock:
            entry = self._store.get(job_id)
            if not entry:
                return
            entry["status"] = "error"
            entry["error"] = error
            entry["percent"] = min(entry.get("percent", 0), 99)
            entry["updated_at"] = time.time()

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._store.get(job_id)
            if not entry:
                return None
            return entry.copy()

    def prune(self, ttl_seconds: float = 3600) -> None:
        cutoff = time.time() - ttl_seconds
        with self._lock:
            expired = [job_id for job_id, entry in self._store.items() if entry.get("updated_at", 0) < cutoff]
            for job_id in expired:
                self._store.pop(job_id, None)


progress_registry = ProgressRegistry()


def touch_progress(job_id: Optional[str], percent: float, message: str) -> None:
    progress_registry.update(job_id, percent=percent, message=message)


def mark_success(job_id: Optional[str], message: str, payload: Optional[Any] = None) -> None:
    progress_registry.complete(job_id, payload=payload, message=message)


def mark_failure(job_id: Optional[str], error: str) -> None:
    progress_registry.fail(job_id, error)
