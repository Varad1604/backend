-- R-07: an unsaved QC draft is overwritten on each save until it is submitted; submitted
-- revisions stay immutable history. Replaces the blanket append-only trigger on QCRevision.
DROP TRIGGER IF EXISTS "QCRevision_no_edit" ON "QCRevision";
CREATE FUNCTION kpmpl_qc_revision_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" <> 'draft' THEN
    RAISE EXCEPTION 'Submitted QC revisions are append-only history' USING ERRCODE = '55000';
  END IF;
  IF NEW."revisionNo" <> OLD."revisionNo" OR NEW."inspectionId" <> OLD."inspectionId" OR NEW."state" NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'A draft can only be finalised in place' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "QCRevision_sealed" BEFORE UPDATE ON "QCRevision"
  FOR EACH ROW EXECUTE FUNCTION kpmpl_qc_revision_sealed();
