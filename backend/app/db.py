"""
AgentProbe Database Layer: SQLModel + SQLite.
Robust initialization that tolerates corrupt or missing database files without crashing startup.
Never stores secrets or raw authorization tokens.
"""
import datetime
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
from sqlmodel import Field, Session, SQLModel, create_engine, select

from app.schemas import (
    FaultSpec,
    GraderResult,
    PolicyConfig,
    RunMetrics,
    RunResponse,
    TraceEvent,
)


logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/agentprobe.db")


class RunRecord(SQLModel, table=True):
    __tablename__ = "runs"

    id: str = Field(primary_key=True, index=True)
    scenario_id: str = Field(index=True)
    agent_type: str = Field(index=True)
    policy_json: str
    seed: int = Field(default=42)
    fault_schedule_json: str
    trace_json: str
    grader_json: str
    metrics_json: str
    created_at: str = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    source: str = Field(default="user", index=True)  # 'user' | 'demo_seed'


class SettingRecord(SQLModel, table=True):
    __tablename__ = "settings"

    key: str = Field(primary_key=True, index=True)
    value: str


class MatrixJobRecord(SQLModel, table=True):
    __tablename__ = "matrix_jobs"

    id: str = Field(primary_key=True, index=True)
    status: str = Field(default="pending", index=True)  # pending, running, completed, failed, cancelled
    config_json: str
    results_json: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    completed_at: Optional[str] = None


class DatabaseManager:
    def __init__(self, db_url: str = DATABASE_URL):
        self.db_url = db_url
        self.engine = None
        self.data_version: int = 0
        self._init_db()

    def _get_sqlite_filepath(self) -> Optional[Path]:
        if self.db_url.startswith("sqlite:///"):
            path_str = self.db_url.replace("sqlite:///", "")
            return Path(path_str).resolve()
        return None

    def _init_db(self):
        file_path = self._get_sqlite_filepath()
        if file_path:
            file_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            self.engine = create_engine(self.db_url, connect_args={"check_same_thread": False} if "sqlite" in self.db_url else {})
            SQLModel.metadata.create_all(self.engine)
            # Additive migration: check if 'source' exists in 'runs'
            from sqlalchemy import text
            with self.engine.connect() as conn:
                try:
                    columns = [row[1] for row in conn.execute(text("PRAGMA table_info(runs)")).fetchall()]
                    if columns and "source" not in columns:
                        conn.execute(text("ALTER TABLE runs ADD COLUMN source VARCHAR DEFAULT 'user'"))
                        conn.commit()
                        logger.info("Migrated 'runs' table: added 'source' column.")
                except Exception as mig_err:
                    logger.debug(f"Migration probe: {mig_err}")

            # Quick integrity probe
            with Session(self.engine) as session:
                session.exec(select(RunRecord).limit(1)).all()
        except Exception as e:
            logger.error(f"Database initialization or integrity probe failed: {e}. Recovering cleanly...")
            if self.engine is not None:
                self.engine.dispose()
            if file_path and file_path.exists():
                backup_name = f"{file_path}.corrupt.{int(datetime.datetime.now().timestamp())}"
                try:
                    shutil.move(str(file_path), backup_name)
                    logger.warning(f"Moved corrupted database to {backup_name}")
                except Exception as move_err:
                    logger.error(f"Failed to move corrupted db: {move_err}")

            # Re-initialize clean engine and tables
            self.engine = create_engine(self.db_url, connect_args={"check_same_thread": False} if "sqlite" in self.db_url else {})
            SQLModel.metadata.create_all(self.engine)

    def close(self):
        if self.engine is not None:
            self.engine.dispose()

    def get_session(self) -> Session:
        return Session(self.engine)

    def get_setting(self, key: str) -> Optional[str]:
        with self.get_session() as session:
            rec = session.get(SettingRecord, key)
            return rec.value if rec else None

    def set_setting(self, key: str, value: str):
        with self.get_session() as session:
            rec = SettingRecord(key=key, value=value)
            session.merge(rec)
            session.commit()
            self.data_version += 1

    def save_run(self, run: RunResponse, source: Optional[str] = None):
        with self.get_session() as session:
            run_source = source or getattr(run, "source", None) or "user"
            record = RunRecord(
                id=run.id,
                scenario_id=run.scenario_id,
                agent_type=run.agent_type,
                policy_json=json.dumps(run.policy_config.model_dump()),
                seed=run.seed,
                fault_schedule_json=json.dumps([f.model_dump() for f in run.fault_schedule]),
                trace_json=json.dumps([t.model_dump() for t in run.trace]),
                grader_json=json.dumps(run.grader_result.model_dump()),
                metrics_json=json.dumps(run.metrics.model_dump()),
                created_at=run.created_at,
                source=run_source,
            )
            session.merge(record)
            session.commit()
            self.data_version += 1

    def get_run(self, run_id: str) -> Optional[RunResponse]:
        with self.get_session() as session:
            record = session.get(RunRecord, run_id)
            if not record:
                return None
            return self._record_to_response(record)

    def list_runs(self, limit: int = 100, offset: int = 0, source: Optional[str] = None) -> List[RunResponse]:
        with self.get_session() as session:
            query = select(RunRecord)
            if source:
                query = query.where(RunRecord.source == source)
            query = query.order_by(RunRecord.created_at.desc()).offset(offset).limit(limit)
            records = session.exec(query).all()
            return [self._record_to_response(r) for r in records]

    def list_all_runs(self, source: Optional[str] = None) -> List[RunResponse]:
        with self.get_session() as session:
            query = select(RunRecord)
            if source:
                query = query.where(RunRecord.source == source)
            query = query.order_by(RunRecord.created_at.desc())
            records = session.exec(query).all()
            return [self._record_to_response(r) for r in records]

    def count_runs(self, source: Optional[str] = None) -> int:
        from sqlmodel import func
        with self.get_session() as session:
            query = select(func.count(RunRecord.id))
            if source:
                query = query.where(RunRecord.source == source)
            res = session.exec(query).one()
            return res or 0

    def clear_runs(self):
        with self.get_session() as session:
            for record in session.exec(select(RunRecord)).all():
                session.delete(record)
            for job in session.exec(select(MatrixJobRecord)).all():
                if job.status in ("pending", "running"):
                    job.status = "cancelled"
                    session.merge(job)
                else:
                    session.delete(job)
            session.commit()
            self.set_setting("demo_seed_declined", "true")
            self.data_version += 1

    def save_matrix_job(self, job: MatrixJobRecord):
        with self.get_session() as session:
            session.merge(job)
            session.commit()
            self.data_version += 1

    def get_matrix_job(self, job_id: str) -> Optional[MatrixJobRecord]:
        with self.get_session() as session:
            return session.get(MatrixJobRecord, job_id)

    def _record_to_response(self, r: RunRecord) -> RunResponse:
        policy = PolicyConfig(**json.loads(r.policy_json))
        faults = [FaultSpec(**f) for f in json.loads(r.fault_schedule_json)]
        trace = [TraceEvent(**t) for t in json.loads(r.trace_json)]
        grader = GraderResult(**json.loads(r.grader_json))
        metrics = RunMetrics(**json.loads(r.metrics_json))

        return RunResponse(
            id=r.id,
            scenario_id=r.scenario_id,
            agent_type=r.agent_type,
            policy_config=policy,
            seed=r.seed,
            fault_schedule=faults,
            trace=trace,
            grader_result=grader,
            metrics=metrics,
            created_at=r.created_at,
            source=getattr(r, "source", "user") or "user",
        )


db_manager = DatabaseManager()
