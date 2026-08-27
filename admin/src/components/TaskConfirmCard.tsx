import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { getToken, getBackendURL } from '../utils/auth';

interface Proposed {
  title: string;
  description?: string;
  content?: string;
  priority: string;
  dueDate: string | null;
}

interface CreatedTask {
  documentId: string;
  title: string;
  consequence: number;
  impact: number;
  priority: string;
}

const SCORE_LABELS: Record<number, string> = {
  1: 'Negligible',
  2: 'Minor',
  3: 'Moderate',
  4: 'Significant',
  5: 'Critical',
};

// --- Styled ---

const Card = styled.div`
  margin-top: 8px;
  border: 1px solid #dcdce4;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fff;
  font-size: 13px;
`;

const Title = styled.div`
  font-weight: 700;
  font-size: 14px;
  color: #32324d;
  margin-bottom: 2px;
`;

const Description = styled.div`
  color: #8e8ea9;
  font-size: 12px;
  margin-bottom: 10px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: #666687;
  min-width: 80px;
`;

const Select = styled.select`
  padding: 4px 8px;
  border: 1px solid #dcdce4;
  border-radius: 4px;
  font-size: 12px;
  background: #fff;
  color: #32324d;
`;

const DateInput = styled.input`
  padding: 4px 8px;
  border: 1px solid #dcdce4;
  border-radius: 4px;
  font-size: 12px;
  color: #32324d;
`;

const AsapButton = styled.button`
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: #4945ff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: #3b38e0;
  }
`;

const ScorePreview = styled.div`
  font-size: 12px;
  color: #666687;
  margin-bottom: 10px;
  font-weight: 500;
`;

const CreateButton = styled.button`
  padding: 8px 18px;
  border: none;
  border-radius: 4px;
  background: #4945ff;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    background: #a5a5ba;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    background: #3b38e0;
  }
`;

const SuccessBanner = styled.div`
  margin-top: 8px;
  border: 1px solid #c6f0c2;
  border-radius: 8px;
  padding: 14px 16px;
  background: #eafbe7;
  font-size: 13px;
  color: #2f6846;
`;

const SuccessTitle = styled.div`
  font-weight: 700;
  margin-bottom: 4px;
`;

const TaskLink = styled(Link)`
  color: #4945ff;
  font-weight: 600;
  text-decoration: none;
  font-size: 12px;

  &:hover {
    text-decoration: underline;
  }
`;

const ErrorText = styled.div`
  color: #d02b20;
  font-size: 12px;
  margin-top: 4px;
`;

// --- Component ---

export function TaskConfirmCard({ proposed }: Readonly<{ proposed: Proposed }>) {
  const [consequence, setConsequence] = useState<number | null>(null);
  const [impact, setImpact] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState(proposed.dueDate ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-hydrate after a page reload.
  //
  // The tool result persisted in the conversation stays `pending_confirmation`
  // forever — creating the task does not rewrite that message. So on a hard
  // refresh this card would render the empty form again, making a task that was
  // saved correctly look like it had lost its due date and severity.
  //
  // Matching on title mirrors the duplicate detection manageTask already uses,
  // and the newest match wins so re-running the same proposal shows the latest.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = getToken();
        const res = await fetch(`${getBackendURL()}/ai-sdk/tasks`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) return;

        const body = (await res.json()) as { data?: CreatedTask[] };
        const match = (body.data ?? []).find((t) => t.title === proposed.title);
        if (match && !cancelled) setCreated(match);
      } catch {
        // Informational only — leave the form usable if the lookup fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [proposed.title]);

  const score = consequence != null && impact != null ? consequence * impact : null;

  async function handleCreate() {
    if (consequence == null || impact == null) return;
    setSubmitting(true);
    setError(null);

    try {
      const token = getToken();
      const backend = getBackendURL();
      const res = await fetch(`${backend}/ai-sdk/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: proposed.title,
          description: proposed.description,
          content: proposed.content,
          priority: proposed.priority,
          consequence,
          impact,
          dueDate: dueDate || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }

      const { data } = await res.json();
      setCreated({
        documentId: data.documentId,
        title: data.title,
        consequence: data.consequence,
        impact: data.impact,
        priority: data.priority,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const s = created.consequence * created.impact;
    return (
      <SuccessBanner>
        <SuccessTitle>Task created: {created.title}</SuccessTitle>
        <span>Score: {created.consequence} x {created.impact} = {s} &middot; Priority: {created.priority}</span>
        <div style={{ marginTop: 6 }}>
          <TaskLink to={`/content-manager/collection-types/plugin::ai-chat.task/${created.documentId}`}>
            Open in Content Manager
          </TaskLink>
        </div>
      </SuccessBanner>
    );
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <Card>
      <Title>{proposed.title}</Title>
      {proposed.description && <Description>{proposed.description}</Description>}

      <Row>
        <Label>Consequence</Label>
        <Select
          value={consequence ?? ''}
          onChange={(e) => setConsequence(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select…</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n} — {SCORE_LABELS[n]}</option>
          ))}
        </Select>
      </Row>

      <Row>
        <Label>Impact</Label>
        <Select
          value={impact ?? ''}
          onChange={(e) => setImpact(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select…</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n} — {SCORE_LABELS[n]}</option>
          ))}
        </Select>
      </Row>

      <Row>
        <Label>Due date</Label>
        <DateInput
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <AsapButton type="button" onClick={() => setDueDate(today)}>ASAP</AsapButton>
      </Row>

      {score != null && (
        <ScorePreview>Score: {consequence} x {impact} = {score}</ScorePreview>
      )}

      <CreateButton
        disabled={consequence == null || impact == null || submitting}
        onClick={handleCreate}
      >
        {submitting ? 'Creating…' : 'Create Task'}
      </CreateButton>

      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
