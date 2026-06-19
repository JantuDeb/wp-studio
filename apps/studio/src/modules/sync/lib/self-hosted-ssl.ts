import type { WebServerKind } from './self-hosted-server-stack';
import type { SelfHostedSslStatus } from '@studio/common/types/sync';

/**
 * SSL/TLS helpers for remote server management (doc 8.2). Pure: a probe command + parser for the
 * current certificate, and certbot command builders per web server. The IPC handlers run these over
 * SSH and wrap mutating steps in the validate→reload→rollback flow from the 8.0 foundation.
 */

/**
 * Probe the live certificate for a host by opening a TLS connection and printing the cert dates,
 * issuer, subject, and SANs via openssl. `certbot_available=…` reports whether certbot is installed.
 * Output is `key=value` lines; SANs come on a single `sans=` line, comma-separated.
 */
export function getSslProbeCommand( host: string, port = 443 ): string {
	const endpoint = `${ host }:${ port }`;
	// `openssl s_client` connects; `x509` extracts fields. All best-effort; missing tools yield blanks.
	return [
		`cert=$(printf '' | openssl s_client -servername ${ host } -connect ${ endpoint } 2>/dev/null | openssl x509 2>/dev/null)`,
		`if [ -n "$cert" ]; then printf 'has_cert=1\\n'; fi`,
		`printf 'issuer=%s\\n' "$(printf '%s' "$cert" | openssl x509 -noout -issuer 2>/dev/null | sed 's/^issuer=//')"`,
		`printf 'subject=%s\\n' "$(printf '%s' "$cert" | openssl x509 -noout -subject 2>/dev/null | sed 's/^subject=//')"`,
		`printf 'not_before=%s\\n' "$(printf '%s' "$cert" | openssl x509 -noout -startdate 2>/dev/null | sed 's/^notBefore=//')"`,
		`printf 'not_after=%s\\n' "$(printf '%s' "$cert" | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"`,
		`printf 'sans=%s\\n' "$(printf '%s' "$cert" | openssl x509 -noout -ext subjectAltName 2>/dev/null | grep -o 'DNS:[^,]*' | sed 's/DNS://g' | paste -sd, -)"`,
		`if command -v certbot >/dev/null 2>&1; then printf 'certbot_available=1\\n'; fi`,
	].join( '; ' );
}

/**
 * Parse the SSL probe output into a structured status. `now` is injected (not read from the clock)
 * so the days-until-expiry math is deterministic and testable.
 */
export function parseSslProbe( output: string, now: number ): SelfHostedSslStatus {
	const values = new Map< string, string >();
	for ( const line of output.split( '\n' ) ) {
		const index = line.indexOf( '=' );
		if ( index > 0 ) {
			values.set( line.slice( 0, index ).trim(), line.slice( index + 1 ).trim() );
		}
	}

	const notAfterRaw = values.get( 'not_after' ) || '';
	const notBeforeRaw = values.get( 'not_before' ) || '';
	const validToMs = notAfterRaw ? Date.parse( notAfterRaw ) : NaN;
	const daysUntilExpiry = Number.isNaN( validToMs )
		? null
		: Math.floor( ( validToMs - now ) / ( 24 * 60 * 60 * 1000 ) );

	const sans = ( values.get( 'sans' ) || '' )
		.split( ',' )
		.map( ( value ) => value.trim() )
		.filter( Boolean );

	const nonEmpty = ( key: string ): string | null => {
		const value = values.get( key );
		return value ? value : null;
	};

	return {
		hasCertificate: values.get( 'has_cert' ) === '1',
		issuer: nonEmpty( 'issuer' ),
		subject: nonEmpty( 'subject' ),
		domains: sans,
		validFrom: notBeforeRaw || null,
		validTo: notAfterRaw || null,
		daysUntilExpiry,
		isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
		certbotAvailable: values.get( 'certbot_available' ) === '1',
	};
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Validate a domain before it ever reaches a shell command, preventing argument injection through
 * the certbot/`-d` flags.
 */
export function assertValidDomain( domain: string ): string {
	if ( ! DOMAIN_PATTERN.test( domain ) ) {
		throw new Error( `Invalid domain: ${ domain }` );
	}
	return domain;
}

export function assertValidEmail( email: string ): string {
	if ( ! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( email ) ) {
		throw new Error( 'A valid contact email is required for Let’s Encrypt.' );
	}
	return email;
}

/**
 * Build the certbot command to issue/renew a Let's Encrypt certificate. Uses certbot's web-server
 * plugin (`--apache`/`--nginx`) so it installs the cert and wires up the vhost automatically,
 * including the HTTP→HTTPS redirect when `redirect` is set. Domains and email are validated by the
 * caller. `--non-interactive --agree-tos` makes it scriptable; `--keep-until-expiring` makes reruns
 * idempotent.
 */
export function getCertbotIssueCommand( params: {
	webServer: WebServerKind;
	domains: string[];
	email: string;
	redirect: boolean;
	canSudo: boolean;
	staging?: boolean;
} ): string {
	const { webServer, domains, email, redirect, canSudo, staging } = params;
	const plugin = webServer === 'nginx' ? '--nginx' : '--apache';
	const domainArgs = domains.map( ( domain ) => `-d ${ assertValidDomain( domain ) }` ).join( ' ' );
	const parts = [
		'certbot',
		plugin,
		domainArgs,
		`-m ${ assertValidEmail( email ) }`,
		'--agree-tos',
		'--non-interactive',
		'--keep-until-expiring',
		redirect ? '--redirect' : '--no-redirect',
	];
	if ( staging ) {
		parts.push( '--staging' );
	}
	const command = parts.join( ' ' );
	return canSudo ? `sudo ${ command }` : command;
}

/** Build the certbot renewal command (renews all installed certs that are near expiry). */
export function getCertbotRenewCommand( canSudo: boolean ): string {
	const command = 'certbot renew --non-interactive';
	return canSudo ? `sudo ${ command }` : command;
}
