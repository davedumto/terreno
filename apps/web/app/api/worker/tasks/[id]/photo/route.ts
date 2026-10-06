import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { checkOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { PhotoUploadError, uploadTaskPhoto } from "@/lib/cloudinary";

const ERROR_STATUS: Record<PhotoUploadError["code"], number> = {
  bad_type: 415,
  too_large: 413,
  upload_failed: 502,
};

/**
 * Uploads a worker-submitted task photo to Cloudinary. Called from
 * /work/[id]'s answer form before the real submit POST, so the resulting
 * photo_key is already in hand when that request is built. Separate from
 * the submit route itself: this route's only job is "get this file to
 * Cloudinary and hand back a key," not task-state mutation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [worker] = await db.select().from(workers).where(eq(workers.id, session.workerId));
  if (!worker || worker.status !== "active") {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const { id } = await params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (task.status !== "claimed" || task.workerId !== worker.id) {
    return NextResponse.json({ error: "not_your_claim" }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_input", details: "expected multipart form data" }, { status: 400 });
  }

  const file = formData.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_input", details: "missing photo field" }, { status: 400 });
  }

  let uploaded;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    uploaded = await uploadTaskPhoto(buffer, file.type, task.id);
  } catch (err) {
    if (err instanceof PhotoUploadError) {
      return NextResponse.json({ error: err.code }, { status: ERROR_STATUS[err.code] });
    }
    console.error("photo upload failed", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  return NextResponse.json({ photo_key: uploaded.publicId, photo_url: uploaded.url });
}
