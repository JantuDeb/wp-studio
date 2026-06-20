import {
	assertValidDomain,
	assertValidEmail,
	getCertbotIssueCommand,
	getCertbotRenewCommand,
	getSslProbeCommand,
	parseSslProbe,
} from 'src/modules/sync/lib/self-hosted-ssl';

const NOW = Date.parse( '2026-06-19T00:00:00.000Z' );

describe( 'getSslProbeCommand', () => {
	it( 'connects to the host on 443 and probes certbot', () => {
		const command = getSslProbeCommand( 'example.com' );
		expect( command ).toContain( '-servername example.com -connect example.com:443' );
		expect( command ).toContain( 'certbot_available=1' );
		expect( command ).toContain( 'sans=' );
	} );
} );

describe( 'parseSslProbe', () => {
	it( 'parses a valid certificate with SANs and computes days-to-expiry', () => {
		const output = [
			'has_cert=1',
			"issuer=C = US, O = Let's Encrypt, CN = R3",
			'subject=CN = example.com',
			'not_before=Jun  1 00:00:00 2026 GMT',
			'not_after=Aug 30 00:00:00 2026 GMT',
			'sans=example.com,www.example.com',
			'certbot_available=1',
		].join( '\n' );

		const ssl = parseSslProbe( output, NOW );
		expect( ssl.hasCertificate ).toBe( true );
		expect( ssl.domains ).toEqual( [ 'example.com', 'www.example.com' ] );
		expect( ssl.certbotAvailable ).toBe( true );
		expect( ssl.isExpired ).toBe( false );
		// Aug 30 is ~72 days after Jun 19.
		expect( ssl.daysUntilExpiry ).toBeGreaterThan( 60 );
	} );

	it( 'flags an expired certificate', () => {
		const output = [ 'has_cert=1', 'not_after=Jan  1 00:00:00 2020 GMT' ].join( '\n' );
		const ssl = parseSslProbe( output, NOW );
		expect( ssl.isExpired ).toBe( true );
		expect( ssl.daysUntilExpiry ).toBeLessThan( 0 );
	} );

	it( 'reports no certificate when the probe is empty', () => {
		const ssl = parseSslProbe( 'has_cert=\n', NOW );
		expect( ssl.hasCertificate ).toBe( false );
		expect( ssl.domains ).toEqual( [] );
		expect( ssl.daysUntilExpiry ).toBeNull();
		expect( ssl.certbotAvailable ).toBe( false );
	} );
} );

describe( 'domain/email validation', () => {
	it( 'accepts valid domains and rejects injection attempts', () => {
		expect( assertValidDomain( 'sub.example.com' ) ).toBe( 'sub.example.com' );
		expect( () => assertValidDomain( 'example.com; rm -rf /' ) ).toThrow();
		expect( () => assertValidDomain( '-d evil' ) ).toThrow();
		expect( () => assertValidDomain( 'localhost' ) ).toThrow();
	} );

	it( 'validates email', () => {
		expect( assertValidEmail( 'a@b.co' ) ).toBe( 'a@b.co' );
		expect( () => assertValidEmail( 'not-an-email' ) ).toThrow();
	} );
} );

describe( 'getCertbotIssueCommand', () => {
	it( 'builds an nginx command with redirect and sudo', () => {
		const command = getCertbotIssueCommand( {
			webServer: 'nginx',
			domains: [ 'example.com', 'www.example.com' ],
			email: 'admin@example.com',
			redirect: true,
			canSudo: true,
		} );
		expect( command ).toBe(
			'sudo certbot --nginx -d example.com -d www.example.com -m admin@example.com --agree-tos --non-interactive --keep-until-expiring --redirect'
		);
	} );

	it( 'builds an apache command without redirect or sudo', () => {
		const command = getCertbotIssueCommand( {
			webServer: 'apache',
			domains: [ 'example.com' ],
			email: 'admin@example.com',
			redirect: false,
			canSudo: false,
		} );
		expect( command ).toContain( '--apache' );
		expect( command ).toContain( '--no-redirect' );
		expect( command.startsWith( 'sudo ' ) ).toBe( false );
	} );

	it( 'rejects an invalid domain before building the command', () => {
		expect( () =>
			getCertbotIssueCommand( {
				webServer: 'nginx',
				domains: [ 'evil.com -d attacker.com' ],
				email: 'a@b.co',
				redirect: true,
				canSudo: false,
			} )
		).toThrow();
	} );

	it( 'adds --staging when requested', () => {
		const command = getCertbotIssueCommand( {
			webServer: 'nginx',
			domains: [ 'example.com' ],
			email: 'a@b.co',
			redirect: true,
			canSudo: false,
			staging: true,
		} );
		expect( command ).toContain( '--staging' );
	} );
} );

describe( 'getCertbotRenewCommand', () => {
	it( 'builds the renew command with and without sudo', () => {
		expect( getCertbotRenewCommand( true ) ).toBe( 'sudo certbot renew --non-interactive' );
		expect( getCertbotRenewCommand( false ) ).toBe( 'certbot renew --non-interactive' );
	} );
} );
