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

    const { person_name, phone_number, status_id, remarks } = data;

    await query(
      "UPDATE calls SET person_name = ?, phone_number = ?, status_id = ?, remarks = ? WHERE id = ?",
      [person_name, phone_number, status_id, remarks, id]
    );

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
