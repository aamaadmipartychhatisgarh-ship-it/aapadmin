import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await query("DELETE FROM calls WHERE id = ?", [id]);

    return Response.json({ message: "Call deleted" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting call:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = await req.json();
    
    // Quick role check: Users can only edit their own, Admins can edit any
    // For simplicity here, we let the frontend govern it, but ideally we check owner.
    if (!isOversight(session)) {
       const [rows] = await query("SELECT user_id FROM calls WHERE id = ?", [id]);
       if (rows && rows.user_id !== session.user.id) {
         return Response.json({ message: "Forbidden" }, { status: 403 });
       }
    }

    const { person_name, phone_number, status_id, remarks, sentiment, address } = data;

    // Read the call as it stands BEFORE this edit. We need the OLD field values
    // to tell which fields the editor actually CHANGED — see the contact
    // propagation below.
    const [oldCall] = await query(
      "SELECT contact_id, person_name, phone_number, address FROM calls WHERE id = ?", [id]
    );

    // Sentiment only applies to a connected ("Phone Picked") call — store NULL
    // for any other status so a correction never leaves a stale sentiment.
    const [statusRow] = await query("SELECT name FROM call_statuses WHERE id = ?", [status_id]);
    const finalSentiment = statusRow?.name === "Phone Picked" ? (sentiment || null) : null;

    await query(
      `UPDATE calls
          SET person_name = ?, phone_number = ?, status_id = ?, remarks = ?,
              sentiment = ?, address = COALESCE(?, address)
        WHERE id = ?`,
      [person_name, phone_number, status_id, remarks || null, finalSentiment, address ?? null, id]
    );

    // Keep the underlying contact in step ONLY for fields the editor actually
    // CHANGED in this edit. ROOT CAUSE of "names/addresses revert over time":
    // this used to overwrite the contact's person_name/phone_number/address from
    // the call-edit form every time — so re-saving an OLD call (whose form still
    // carries the values as they were at call time) silently REVERTED a newer
    // admin edit on the master contact. By diffing against the call's previous
    // values we propagate a genuine correction but never clobber the contact with
    // a stale, unchanged value.
    if (oldCall?.contact_id) {
      const sets = [];
      const vals = [];
      if (person_name !== oldCall.person_name) { sets.push("person_name = ?"); vals.push(person_name); }
      if (phone_number !== oldCall.phone_number) { sets.push("phone_number = ?"); vals.push(phone_number); }
      // Address is optional on the form; only push a non-null value the editor
      // genuinely changed.
      if (address != null && address !== oldCall.address) { sets.push("address = ?"); vals.push(address); }
      if (sets.length) {
        vals.push(oldCall.contact_id);
        await query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);
      }
    }

    return Response.json({ message: "Call updated" }, { status: 200 });
  } catch (error) {
    console.error("Error updating call:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const [call] = await query("SELECT * FROM calls WHERE id = ?", [id]);
    
    if (!call) return Response.json({ message: "Not found" }, { status: 404 });

    return Response.json({ call }, { status: 200 });
  } catch (error) {
    console.error("Error fetching call:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
