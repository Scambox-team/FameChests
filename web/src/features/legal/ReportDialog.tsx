import { S, touch, useGame } from '../../game/store';
import { person } from '../../game/rules';
import { Modal } from '../../ui/Modal';
import { ReportForm } from './ReportForm';

/** „Zgłoś problem z kartą” z podglądu karty: okno otwiera się nad dowolnym ekranem gry */
export function ReportDialog() {
  const { reportCard } = useGame();
  if (!reportCard) return null;
  const close = () => { S.reportCard = null; touch(); };
  const p = person(reportCard.pid);
  return (
    <Modal title="Zgłoś problem z kartą" onClose={close}>
      <ReportForm pid={reportCard.pid} variant={reportCard.variant} cardLabel={p?.name} onDone={close} />
    </Modal>
  );
}
