import re
from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes().decode("utf-8")

# Find and fix the broken accounting method region
# The current broken region is approximately lines 403-412
# We need to restore the original accounting method structure

# First, let's identify the exact boundaries by looking for key markers
# The accounting method should have this structure:
#   accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {
#     const capability: Capability = ...
#     return this.writes.run(actor, capability, `/document-packages/${id}/accounting`, key, { version, ...input }, async (tx, current) => {
#       // method body
#       return { status: 200, body: json({ data: await this.present(tx, id) }) };
#     });
#   }

# Let's replace the broken region with the correct one
# We'll find the section from "async accounting" through the stray closing braces

pattern = r"  async accounting\(actor: Actor, id: string, key: string, version: number, input: AccountingAction\) \{\r\n\s+async\s+accounting\(actor: Actor, id: string, key: string, version: number, input: AccountingAction\) \{\r\n\s+\}\r\n\s+\}\r\n"

# Actually, let's just do a simpler replacement: find the region from line 403 to 412 and replace
# Let me use a more targeted approach - find the accounting method and replace it entirely

# Find "  async accounting" and replace through the end of the method
# The method ends with "}" after the closing "});"

# Let me just rewrite the whole file using known correct content
# I'll construct the correct accounting method and insert it

correct_accounting_method = '''  accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {\n    const capability: Capability = input.kind === 'post_bill' ? 'accounting.post'\n      : input.kind === 'return_to_accountant' || input.kind === 'approve_accounting' ? 'accounting.approve'\n      : 'accounting.review';\n    return this.writes.run(actor, capability, `/document-packages/${id}/accounting`, key, { version, ...input }, async (tx, current) => {\n      const before = await this.row(tx, id);\n      if (!ACCOUNTING_VISIBLE.includes(before.status as (typeof ACCOUNTING_VISIBLE)[number])) throw new NotFoundException();\n      await this.claim(tx, id, version);\n      const status = before.status; const record = before.accounting;\n      const isHead = actor.capabilities.includes('accounting.approve');\n      let detail: string | undefined;\n\n      if (input.kind === 'start_accounting') {\n        if (status !== 'verified') {\n          throw domain(ACCOUNTING_STATES.includes(status as (typeof ACCOUNTING_STATES)[number])\n            ? 'Accounting has already started on this package.'\n            : 'Only a Head-Office-verified package can move to Accounts.');\n        }\n        await tx.accountingRecord.create({ data: { packageId: id, stage: 'with_accountant', startedBy: current.userId } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'with_accounting' } });\n        detail = 'Documents verified by Head Office. Accounting review started.';\n      }\n\n      if (input.kind === 'submit_to_head_accountant') {\n        if (status !== 'with_accounting') throw domain('Only a package with Accounts can be sent to the Head Accountant.');\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { stage: 'with_head_accountant', ...(input.accountantNote ? { accountantNote: input.accountantNote } : {}), submittedBy: current.userId, submittedAt: new Date() } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'with_head_accountant' } });\n        detail = input.accountantNote?.trim() ? `Accountant handed over. Note: ${input.accountantNote.trim()}` : 'Accountant confirmed the accounting entries are complete.';\n      }\n\n      if (input.kind === 'return_to_ho') {\n        if (status !== 'with_accounting') throw domain('Only a package with Accounts can be returned to Head Office.');\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { stage: 'verified' } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'verified' } });\n        detail = input.reason.trim();\n      }\n\n      if (input.kind === 'return_to_accountant') {\n        if (status !== 'with_head_accountant') throw domain('Only a package with the Head Accountant can be returned.');\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { stage: 'with_accountant' } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'with_accounting' } });\n        detail = input.reason.trim();\n      }\n\n      if (input.kind === 'approve_accounting') {\n        if (status !== 'with_head_accountant') throw domain('The Accountant must send the package to the Head Accountant first.');\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { stage: 'approved', approvedBy: current.userId, approvedAt: new Date(), ...(input.headAccountantNote ? { headAccountantNote: input.headAccountantNote } : {}) } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'accounting_approved' } });\n        detail = input.headAccountantNote?.trim() ? `Head Accountant approved. Note: ${input.headAccountantNote.trim()}` : 'Head Accountant approved the accounting.';\n      }\n\n      if (input.kind === 'post_bill') {\n        // Duplicate-posting guard: bill_posted is terminal for accounting actions.\n        if (status === 'bill_posted') throw domain('This bill is already posted. Posting it twice is not allowed.');\n        if (status !== 'accounting_approved') throw domain('The Head Accountant must approve the package before the bill can be posted.');\n        const previousRef = record?.accountingRef ?? null;\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { stage: 'posted', accountingRef: input.billRef, postedBy: current.userId, postedAt: new Date() } });\n        await tx.documentPackage.update({ where: { id }, data: { status: 'bill_posted' } });\n        detail = `Bill ${input.billRef} posted. Internal accounting status — DataMan milestones are confirmed separately.`;\n        await this.history(tx, id, current.userId, 'post_bill', detail);\n        await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: 'bill_posted',\n          ...(previousRef && previousRef !== input.billRef ? { oldValue: { status, accountingRef: previousRef } } : { oldValue: { status } }),\n          newValue: { status: 'bill_posted', accountingRef: input.billRef } });\n        await this.noteVisitLinks(tx, before.packageRef, current.userId, before.visits.map(link => link.visitId), 'bill_posted', `Bill ${input.billRef} posted (package ${before.packageRef}). Internal accounting status; not an ERP confirmation.`);\n        return { status: 200, body: json({ data: await this.present(tx, id) }) };\n      }\n\n      if (input.kind === 'correct_accounting') {\n        if (!record) throw domain('Start accounting on this package first.');\n        if (status === 'bill_posted') throw domain('The bill is posted. No further accounting changes.');\n        // Stage authority: the Accountant works the package while it is with them; once it is\n        // with the Head Accountant (or approved), only the Head Accountant corrects. The Head\n        // Accountant's note is theirs alone. Financial fields (amounts, tax, ledger) are NOT\n        // editable here — pending an explicit KPMPL decision (see overnight-reports/DECISIONS.md).\n        if (status !== 'with_accounting' && !isHead) throw domain('The package is with the Head Accountant. Only the Head Accountant can change it now.');\n        if (input.field === 'headAccountantNote' && !isHead) throw domain('Only the Head Accountant can change the Head Accountant note.');\n        const currentValue = input.field === 'accountingRef' ? record.accountingRef : input.field === 'accountantNote' ? record.accountantNote : record.headAccountantNote;\n        const nextValue = input.value.trim();\n        if (currentValue === nextValue) throw domain('The new value is the same as the current one. Nothing to correct.');\n        await tx.accountingRecord.update({ where: { packageId: id }, data: { [input.field]: nextValue } });\n        await tx.accountingCorrection.create({ data: { packageId: id, field: input.field, oldValue: currentValue, newValue: nextValue, reason: input.reason, correctedBy: current.userId } });\n        await this.history(tx, id, current.userId, 'accounting_corrected',\n          `${input.field === 'accountingRef' ? 'Accounting reference' : input.field === 'accountantNote' ? 'Accountant note' : 'Head Accountant note'}: ${currentValue ? `“${currentValue}”` : '—'} → “${nextValue}”. Reason: ${input.reason}`);\n        await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: 'accounting_corrected', reason: input.reason,\n          oldValue: { field: input.field, value: currentValue }, newValue: { field: input.field, value: nextValue } });\n        return { status: 200, body: json({ data: await this.present(tx, id) }) };\n      }\n\n      await this.history(tx, id, current.userId, input.kind, detail);\n      if (input.kind === 'return_to_accountant') {\n        await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: input.kind, reason: input.reason, oldValue: { status }, newValue: { status: 'with_accounting' } });\n      } else {\n        await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: input.kind, oldValue: { status }, newValue: { status: input.kind === 'start_accounting' ? 'with_accounting' : input.kind === 'submit_to_head_accountant' ? 'with_head_accountant' : 'accounting_approved' } });\n      }\n      return { status: 200, body: json({ data: await this.present(tx, id) }) };\n    });\n  }'''

# Replace the broken region - find "  accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {" and replace through the end of the method
# We need to find the start and end markers

# Strategy: replace from "  accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {" 
# through the matching closing braces

# Let me just do a simple string replacement of the whole method
# First, find where the current accounting method starts
start_marker = "  accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {"
end_marker = "  }  \\/\\/ HO"

# Find the start
start_idx = data.find(start_marker)
if start_idx == -1:
    print("ERROR: Could not find start marker")
    raise SystemExit(1)

# Find the end - look for the closing "}" that matches the method
# We need to find the right "}" - it's after the "});" that closes writes.run
# Let me just find from start_idx to a reasonable end

# Actually, let me use a different approach - replace the entire broken block
# The broken block starts at "  accounting(actor: Actor, id: string, key: string, version: number, input: AccountingAction) {"
# and ends after the second "}" that closes the method

# Let me find the end by looking for the pattern of "}" followed by blank line and comment
# After the accounting method, the next thing should be the headAccountantCases method

# Let me just search for "  /** HO" after the accounting method
end_search = data.find("  /** HO", start_idx)
if end_search == -1:
    print("ERROR: Could not find end marker")
    raise SystemExit(1)

# The end of the accounting method is just before "  /** HO"
# But we need to include the "}" that closes the method
# Let me find the correct position - it should be the "}" that is at the end of the method

# Let me just take a substring from start_idx to end_search and replace it
broken_region = data[start_idx:end_search]

# Now replace the broken region with the correct method
new_data = data[:start_idx] + correct_accounting_method + data[end_search:]

# Wait, the correct_accounting_method already ends with "};" and "  }", but the original
# had the method ending differently. Let me check what the correct ending should be.

# Actually, looking at the correct_accounting_method I defined, it ends with:
# "      return { status: 200, body: json({ data: await this.present(tx, id) }) };\n    });\n  }"
# This should be correct - it has the return statement, the "});" closing writes.run, and "}" closing the method.

# But I need to make sure the indentation and structure matches. Let me verify by checking
# what the data looks like around the replacement area.

# Let me just proceed and see if tsc works
new_path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts.new")
new_path.write_text(new_data, encoding="utf-8")
print("WROTE NEW FILE")

# Now let's check if the new file has the right structure
with open(new_path, 'r') as f:
    lines = f.readlines()
    for i, line in enumerate(lines[400:430], start=401):
        print(f"{i:4d}: {line.rstrip()}")