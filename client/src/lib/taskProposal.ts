export type TaskProposal = {
  action: "create_task" | "update_task" | "cancel_task";
  title: string;
  targetTask: string | null;
  sourceText: string;
  scheduledAt: string | null;
  scheduleLabel: string | null;
  requiresConfirmation: true;
};

export function buildTaskConfirmationInput(proposal: TaskProposal) {
  return {
    action: proposal.action,
    title: proposal.title,
    targetTask: proposal.targetTask,
    sourceText: proposal.sourceText,
    scheduledAt: proposal.scheduledAt,
  } as const;
}
