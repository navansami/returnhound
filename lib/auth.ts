import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { emailLayout, sendEmail } from "@/lib/email";

const ALLOWED_DOMAIN = "fairmont.com";

function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/** Better Auth endpoints whose body carries an email and must be domain-restricted. */
const EMAIL_ENDPOINTS = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/magic-link",
  "/request-password-reset",
]);

export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Lost & Found password",
        html: emailLayout({
          title: "Reset your password",
          body: `<p>Hi ${user.name},</p>
<p>Someone requested a password reset for your Lost &amp; Found account. If that was you, tap the button below to choose a new password.</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;border-radius:8px;text-decoration:none;">Reset password</a></p>
<p style="color:#71717a;">If you didn't request this, you can safely ignore this email.</p>`,
        }),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Lost & Found account",
        html: emailLayout({
          title: "Confirm your email",
          body: `<p>Hi ${user.name},</p>
<p>Please confirm your email address to activate your Lost &amp; Found account.</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;border-radius:8px;text-decoration:none;">Verify email</a></p>`,
        }),
      });
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Your Lost & Found sign-in link",
          html: emailLayout({
            title: "Magic sign-in link",
            body: `<p>Here's your secure sign-in link for Lost &amp; Found. It expires in 5 minutes.</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;border-radius:8px;text-decoration:none;">Sign in</a></p>
<p style="color:#71717a;">If you didn't request this link, you can ignore this email.</p>`,
          }),
        });
      },
    }),
    nextCookies(),
  ],
  user: {
    additionalFields: {
      // `input: false` — the client can never set their own role.
      role: { type: "string", required: true, defaultValue: "moderator", input: false },
      employeeId: { type: "string", required: false, input: true },
      department: { type: "string", required: false, input: true },
      disabled: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (EMAIL_ENDPOINTS.has(ctx.path)) {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && !isAllowedEmail(email)) {
          throw new APIError("BAD_REQUEST", {
            message: `Access is restricted to @${ALLOWED_DOMAIN} email addresses.`,
          });
        }
        // Disabled accounts can't sign in (existing users only).
        if ((ctx.path === "/sign-in/email" || ctx.path === "/sign-in/magic-link") && typeof email === "string") {
          const [userRow] = await db
            .select({ disabled: schema.user.disabled })
            .from(schema.user)
            .where(eq(schema.user.email, email.toLowerCase()))
            .limit(1);
          if (userRow?.disabled) {
            throw new APIError("UNAUTHORIZED", {
              message: "This account has been disabled by an administrator.",
            });
          }
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // Bootstrap: the very first account ever created becomes the admin.
      if (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/magic-link") {
        const newUser = ctx.context.newSession?.user;
        if (newUser) {
          const count = await db.$count(schema.user);
          if (count === 1) {
            await db
              .update(schema.user)
              .set({ role: "admin" })
              .where(eq(schema.user.id, newUser.id));
          }
        }
      }
    }),
  },
});
