import { NextResponse, type NextRequest } from "next/server";

import { signUpload } from "@/lib/cloudinary";
import { getSession } from "@/lib/session";

/** Returns a signed Cloudinary upload payload for an authenticated user. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let folder = "returnhound";
  let publicId: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.folder === "string" && body.folder) folder = body.folder;
    if (typeof body?.publicId === "string" && body.publicId) publicId = body.publicId;
  } catch {
    // no body — defaults are fine
  }

  return NextResponse.json(signUpload({ folder, publicId }));
}
