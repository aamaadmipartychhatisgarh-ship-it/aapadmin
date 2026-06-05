import CredentialsProvider from "next-auth/providers/credentials";
import { query } from "@/lib/db";
import bcrypt from "bcryptjs";
import { isOversight, isAdmin as isAdminRole, OVERSIGHT_ROLES } from "@/lib/permissions";

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) return null;

        try {
          const users = await query("SELECT * FROM users WHERE username = ?", [credentials.username]);
          const user = users[0];

          if (!user) return null;
          if (user.is_active === 0) return null;

          const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
          if (!isPasswordValid) return null;

          return {
            id: user.id.toString(),
            name: user.username,
            role: user.role,
            home_district_id: user.home_district_id ?? null,
            scope_zone_id: user.scope_zone_id ?? null,
            scope_lok_sabha_id: user.scope_lok_sabha_id ?? null,
            scope_assembly_id: user.scope_assembly_id ?? null,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.home_district_id = user.home_district_id ?? null;
        token.scope_zone_id = user.scope_zone_id ?? null;
        token.scope_lok_sabha_id = user.scope_lok_sabha_id ?? null;
        token.scope_assembly_id = user.scope_assembly_id ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.home_district_id = token.home_district_id ?? null;
        session.user.scope_zone_id = token.scope_zone_id ?? null;
        session.user.scope_lok_sabha_id = token.scope_lok_sabha_id ?? null;
        session.user.scope_assembly_id = token.scope_assembly_id ?? null;
      }
      return session;
    }
  },
  events: {
    async signIn({ user }) {
      try {
        await query("INSERT INTO attendance_log (user_id, login_at) VALUES (?, NOW())", [user.id]);
        await query("UPDATE users SET last_seen_at = NOW() WHERE id = ?", [user.id]);
      } catch (e) {
        console.error("attendance_log insert failed:", e);
      }
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Back-compat helpers — now delegate to the central permissions model so both
// legacy ("admin"/"user") and canonical ("super_admin"/"caller") roles resolve.
export const SUPERVISOR_ROLES = OVERSIGHT_ROLES;
export const isSupervisor = (session) => isOversight(session);
export const isAdmin = (session) => isAdminRole(session);
