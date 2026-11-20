import type { Operation } from '../../../packages/banking/contracts';
import Icon from './Icon';
import { money } from './money';

export function statusText(operation: Operation) {
  if (operation.status === 'failed' && operation.kind === 'payout') return 'Funds returned';
  return { completed: 'Completed', pending: 'Awaiting result', processing: 'Processing', failed: 'Failed', review: 'Needs review' }[operation.status];
}
export function operationLabel(operation: Operation) {
  return { funding: 'Demo USD received', exchange: 'USD → NGN conversion', payout: 'Demo NGN payout' }[operation.kind];
}
export function Activity({ operations, detailed = false, onAddFunds }: { operations: Operation[]; detailed?: boolean; onAddFunds: () => void }) {
  if (!operations.length) return <div className="empty-state"><span className="empty-icon"><Icon name="activity"/></span><h3>Your story starts here</h3><p>Add demo USD to make your first transaction. Every step will appear here.</p><button className="button subtle" onClick={onAddFunds}><Icon name="plus"/> Add demo USD</button></div>;
  return <div className="activity-list">{operations.map(operation => <article className="activity-item" key={operation.id}>
    <span className={`transaction-icon ${operation.kind}`}><Icon name={operation.kind === 'funding' ? 'plus' : operation.kind === 'exchange' ? 'exchange' : 'arrow'}/></span>
    <div className="transaction-info"><h3>{operationLabel(operation)}</h3><p>{new Date(operation.createdAt).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{operation.beneficiary && <span> · {operation.beneficiary}</span>}</p>
    {detailed && <details className="transaction-details"><summary>View record</summary><dl><dt>Reference</dt><dd>{operation.id}</dd><dt>Last updated</dt><dd>{new Date(operation.updatedAt).toLocaleString('en-NG')}</dd>{operation.receivedMinor && <><dt>NGN received</dt><dd>{money(operation.receivedMinor, 'NGN')}</dd></>}{operation.error && <><dt>Status detail</dt><dd>{operation.error}</dd></>}<dt>Environment</dt><dd>Sandbox · simulated funds</dd></dl></details>}
    </div><div className="transaction-value"><strong>{operation.kind === 'funding' ? '+' : '−'}{money(operation.amountMinor, operation.currency)}</strong><span className={`status ${operation.status}`}>{statusText(operation)}</span></div>
  </article>)}</div>;
}
