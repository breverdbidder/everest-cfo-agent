"""add saved scenarios

Revision ID: c4d5e6f7a8b9
Revises: a1b2c3d4e5f6
Create Date: 2026-03-07 11:15:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_scenarios",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("simulation_id", sa.String(length=50), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("runway_months_before", sa.Numeric(8, 2), nullable=False),
        sa.Column("runway_months_after", sa.Numeric(8, 2), nullable=False),
        sa.Column("weekly_impact", sa.Numeric(18, 2), nullable=False),
        sa.Column("proof_points", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_scenarios_run_id", "saved_scenarios", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_scenarios_run_id", "saved_scenarios")
    op.drop_table("saved_scenarios")
