// Internal controls for financial documents (vouchers, expenses, settlements,
// rider cash movements):
//  - status changes must follow the document's allowed transitions; paid,
//    received, completed, rejected and cancelled documents are final
//  - financial fields are read-only once a document is approved/posted;
//    corrections go through a reversing journal voucher
//  - maker-checker: the person who prepared a document cannot approve or pay it
//
// Maker-checker always applies to staff. It applies to admins too when
// FINANCE_STRICT_MAKER_CHECKER=true (turn on once two people handle finance).

const DOCUMENTS = {
  payment_voucher: {
    table: 'cash_payment_vouchers',
    label: 'Payment voucher',
    makerColumn: 'prepared_by',
    transitions: {
      draft: ['pending', 'approved', 'cancelled'],
      pending: ['draft', 'approved', 'cancelled'],
      approved: ['paid'],
      paid: [],
      cancelled: [],
    },
    lockedStatuses: ['approved', 'paid'],
    lockedFields: { amount: 'amount', payee_name: 'payee_name', payee_type: 'payee_type', payee_id: 'payee_id', payment_method: 'payment_method' },
    checkerStatuses: ['approved', 'paid'],
  },
  receipt_voucher: {
    table: 'cash_receipt_vouchers',
    label: 'Receipt voucher',
    makerColumn: 'prepared_by',
    // The table has no 'approved' status: confirming a receipt marks it received
    // (the route maps an incoming 'approved' to 'received').
    transitions: {
      draft: ['pending', 'received', 'cancelled'],
      pending: ['draft', 'received', 'cancelled'],
      received: [],
      cancelled: [],
    },
    lockedStatuses: ['received'],
    lockedFields: { amount: 'amount', payer_name: 'payer_name', payer_type: 'payer_type', payer_id: 'payer_id', payment_method: 'payment_method' },
    checkerStatuses: ['received'],
  },
  expense: {
    table: 'admin_expenses',
    label: 'Expense',
    makerColumn: 'submitted_by',
    transitions: {
      pending: ['approved', 'rejected'],
      approved: ['paid', 'rejected'],
      paid: [],
      rejected: [],
    },
    lockedStatuses: ['approved', 'paid'],
    lockedFields: { amount: 'amount' },
    checkerStatuses: ['approved', 'paid'],
  },
  settlement: {
    table: 'store_settlements',
    label: 'Settlement',
    makerColumn: null,
    // The person who approved a settlement cannot also pay it
    payerMustDifferFromApprover: true,
    transitions: {
      pending: ['approved', 'cancelled'],
      approved: ['paid', 'cancelled'],
      paid: [],
      cancelled: [],
    },
    lockedStatuses: ['approved', 'paid'],
    lockedFields: { net_amount: 'net_amount' },
    checkerStatuses: [],
  },
  rider_cash: {
    table: 'rider_cash_movements',
    label: 'Rider cash movement',
    makerColumn: 'recorded_by',
    transitions: {
      pending: ['approved', 'completed', 'cancelled'],
      approved: ['completed'],
      completed: [],
      cancelled: [],
    },
    lockedStatuses: ['approved', 'completed'],
    lockedFields: { amount: 'amount' },
    checkerStatuses: ['approved', 'completed'],
  },
};

function makerCheckerApplies(user) {
  return user.user_type !== 'admin' || process.env.FINANCE_STRICT_MAKER_CHECKER === 'true';
}

function sameValue(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return a == b; // eslint-disable-line eqeqeq
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return Math.abs(na - nb) < 0.005;
  }
  return String(a) === String(b);
}

// Returns null when the update is allowed, otherwise { status, message }.
async function checkDocumentUpdate(db, user, docType, id, body) {
  const cfg = DOCUMENTS[docType];
  const [rows] = await db.execute(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
  if (!rows.length) {
    return { status: 404, message: `${cfg.label} not found` };
  }
  const doc = rows[0];
  const current = String(doc.status || '').toLowerCase();
  const target = body.status !== undefined && body.status !== null ? String(body.status).toLowerCase() : null;
  const allowed = cfg.transitions[current];

  if (allowed && allowed.length === 0) {
    return { status: 409, message: `${cfg.label} is ${current} and can no longer be changed` };
  }

  if (target && target !== current && allowed && !allowed.includes(target)) {
    return { status: 409, message: `${cfg.label} cannot move from "${current}" to "${target}"` };
  }

  if (cfg.lockedStatuses.includes(current)) {
    for (const [field, column] of Object.entries(cfg.lockedFields)) {
      if (!(column in doc)) continue;
      if (body[field] !== undefined && !sameValue(body[field], doc[column])) {
        return {
          status: 409,
          message: `${field} cannot be changed once the ${cfg.label.toLowerCase()} is ${current}; correct it with a journal voucher`,
        };
      }
    }
  }

  if (target && target !== current && makerCheckerApplies(user)) {
    if (cfg.makerColumn && cfg.checkerStatuses.includes(target) &&
        doc[cfg.makerColumn] && Number(doc[cfg.makerColumn]) === Number(user.id)) {
      return { status: 403, message: `The person who prepared this ${cfg.label.toLowerCase()} cannot approve or pay it` };
    }
    if (cfg.payerMustDifferFromApprover && target === 'paid' &&
        doc.approved_by && Number(doc.approved_by) === Number(user.id)) {
      return { status: 403, message: `The person who approved this ${cfg.label.toLowerCase()} cannot also pay it` };
    }
  }

  return null;
}

module.exports = { checkDocumentUpdate, makerCheckerApplies, DOCUMENTS };
