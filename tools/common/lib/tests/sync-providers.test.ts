import {
	SelfHostedConnectorPluginSyncProvider,
	SelfHostedRestContentSyncProvider,
	SelfHostedSshSyncProvider,
	WpcomSyncProvider,
} from '@studio/common/lib/sync/providers';
import {
	selfHostedRestConnectionSchema,
	syncConnectionSchema,
	syncSiteSchema,
} from '@studio/common/types/sync';

describe( 'sync provider types', () => {
	it( 'keeps legacy WordPress.com sync sites valid without an explicit provider', () => {
		const site = syncSiteSchema.parse( {
			id: 123,
			localSiteId: 'local-site-id',
			name: 'Remote Site',
			url: 'https://example.wordpress.com',
			isStaging: false,
			isPressable: false,
			environmentType: 'production',
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		} );

		expect( site.provider ).toBeUndefined();
		expect( syncConnectionSchema.parse( site ) ).toEqual( site );
	} );

	it( 'parses a self-hosted REST content connection', () => {
		const connection = selfHostedRestConnectionSchema.parse( {
			id: 'connection-id',
			localSiteId: 'local-site-id',
			provider: 'self-hosted-rest',
			siteUrl: 'https://example.com',
			environmentType: 'production',
			syncMode: 'rest-content',
			auth: {
				username: 'admin',
				applicationPassword: 'xxxx xxxx xxxx xxxx xxxx xxxx',
			},
			capabilities: {
				canPush: true,
				canPushToProduction: true,
				canSyncContent: true,
			},
		} );

		expect( connection.lastPullTimestamp ).toBeNull();
		expect( connection.lastPushTimestamp ).toBeNull();
		expect( connection.capabilities.canSyncDatabase ).toBe( false );
		expect( syncConnectionSchema.parse( connection ) ).toEqual( connection );
	} );
} );

describe( 'sync providers', () => {
	it( 'describes WordPress.com archive sync capabilities', () => {
		const provider = new WpcomSyncProvider();

		expect( provider.provider ).toBe( 'wpcom' );
		expect( provider.capabilities ).toMatchObject( {
			canPull: true,
			canPush: true,
			canSyncDatabase: true,
			canSyncFiles: true,
		} );
	} );

	it( 'keeps self-hosted REST scoped to content push', () => {
		const provider = new SelfHostedRestContentSyncProvider();

		expect( provider.provider ).toBe( 'self-hosted-rest' );
		expect( provider.capabilities ).toMatchObject( {
			canPull: false,
			canPush: true,
			canPushToProduction: true,
			canSyncContent: true,
			canSyncDatabase: false,
			canSyncFiles: false,
		} );
	} );

	it( 'disables production push for full-sync self-hosted providers', () => {
		const sshProvider = new SelfHostedSshSyncProvider();
		const connectorProvider = new SelfHostedConnectorPluginSyncProvider();

		expect( sshProvider.capabilities.canPushToProduction ).toBe( false );
		expect( connectorProvider.capabilities.canPushToProduction ).toBe( false );
		expect( sshProvider.capabilities.requiresBackupBeforePush ).toBe( true );
		expect( connectorProvider.capabilities.requiresBackupBeforePush ).toBe( true );
	} );
} );
