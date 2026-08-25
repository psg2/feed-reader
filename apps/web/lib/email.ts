import { Resend } from "resend";
import { env } from "./env";

/** Sender for transactional mail; the domain must be verified in Resend. */
const FROM_EMAIL = env.EMAIL_FROM ?? "Feed Reader <noreply@example.com>";

let resend: Resend | null = null;

function getResend(): Resend | null {
	if (resend) return resend;
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) return null;
	resend = new Resend(apiKey);
	return resend;
}

interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
}

/**
 * Send an email via Resend. Falls back to console.log in development
 * when RESEND_API_KEY is not set.
 */
export async function sendEmail({
	to,
	subject,
	html,
}: SendEmailParams): Promise<void> {
	const client = getResend();
	if (!client) {
		console.log(`📧 [Email] To: ${to} | Subject: ${subject}`);
		console.log(`📧 [Email] Body (dev mode — no RESEND_API_KEY):\n${html}\n`);
		return;
	}

	const { error } = await client.emails.send({
		from: FROM_EMAIL,
		to,
		subject,
		html,
	});

	if (error) {
		console.error("Failed to send email:", error);
		throw new Error(`Failed to send email: ${error.message}`);
	}
}

/* ─── OTP Emails ─── */

interface SendOtpEmailParams {
	to: string;
	subject: string;
	otp: string;
	expiresIn: string;
}

/**
 * Send an OTP verification email.
 * In dev mode (no RESEND_API_KEY), logs the code prominently.
 */
export async function sendOtpEmail({
	to,
	subject,
	otp,
	expiresIn,
}: SendOtpEmailParams): Promise<void> {
	const client = getResend();

	if (!client) {
		console.log(
			`\n📧 [OTP] To: ${to} | Code: ${otp} | Expires: ${expiresIn}\n`,
		);
		return;
	}

	const html = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
			<h2 style="margin: 0 0 16px;">Your verification code</h2>
			<div style="background: #f4f4f5; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
				<span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; font-family: monospace;">${otp}</span>
			</div>
			<p style="color: #666; font-size: 14px; line-height: 1.5;">
				This code expires in ${expiresIn}. If you didn't request this, you can safely ignore this email.
			</p>
		</div>
	`;

	await sendEmail({ to, subject, html });
}

/* ─── Invitations ─── */

/** True when mail can actually be delivered (Resend key + verified From address). */
export function isEmailConfigured(): boolean {
	return !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}

interface SendInviteEmailParams {
	to: string;
	url: string;
	host: string;
	expiresAt: Date;
}

export async function sendInviteEmail({
	to,
	url,
	host,
	expiresAt,
}: SendInviteEmailParams): Promise<void> {
	const html = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
			<h2 style="margin: 0 0 16px;">You're invited to Feed Reader</h2>
			<p style="color: #444; font-size: 15px; line-height: 1.5;">
				Someone invited you to create an account on <strong>${host}</strong>.
			</p>
			<p style="margin: 24px 0;">
				<a href="${url}" style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 20px; font-weight: 600;">Create your account</a>
			</p>
			<p style="color: #666; font-size: 13px; line-height: 1.5;">
				Or paste this link in your browser:<br /><a href="${url}" style="color: #666;">${url}</a>
			</p>
			<p style="color: #666; font-size: 13px; line-height: 1.5;">
				The invitation is for this address only and expires on ${expiresAt.toUTCString()}. If you weren't expecting it, you can ignore this e-mail.
			</p>
		</div>
	`;
	await sendEmail({
		to,
		subject: `You're invited to Feed Reader on ${host}`,
		html,
	});
}
