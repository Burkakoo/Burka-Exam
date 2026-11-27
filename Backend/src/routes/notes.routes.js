import { Router } from "express";
import {
  createNote,
  deleteNote,
  deleteNotePdf,
  downloadNotePdf,
  listNotes,
  syncChanges,
  updateNote,
  uploadNotePdf
} from "../controllers/notes.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { validateObjectId } from "../middleware/validateObjectId.middleware.js";
import { syncRateLimit } from "../middleware/rateLimit.middleware.js";

const router = Router();

router.get("/", requireAuth, listNotes);
router.post("/", requireAuth, createNote);
router.get("/:id/pdf", requireAuth, validateObjectId("id"), downloadNotePdf);
router.post("/:id/pdf", requireAuth, requireRole("admin", "teacher", "content_manager"), validateObjectId("id"), uploadNotePdf);
router.delete("/:id/pdf", requireAuth, requireRole("admin", "teacher", "content_manager"), validateObjectId("id"), deleteNotePdf);
router.put("/:id", requireAuth, validateObjectId("id"), updateNote);
router.delete("/:id", requireAuth, validateObjectId("id"), deleteNote);
router.post("/sync", requireAuth, syncRateLimit, syncChanges);

export default router;
