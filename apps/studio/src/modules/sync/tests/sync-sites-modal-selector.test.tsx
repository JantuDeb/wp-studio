// To run tests, execute `npm run test -- src/modules/sync/tests/sync-sites-modal-selector.test.tsx` from the root directory
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { fireEvent, render, screen } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SitesListContent,
	SyncSitesModalSelector,
} from 'src/modules/sync/components/sync-sites-modal-selector';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { setWpcomClient } from 'src/stores/wpcom-api';
import type { SitesQueryResult } from 'src/modules/sync/components/sync-sites-modal-selector';

store.replaceReducer( testReducer );

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-offline' );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.4',
	id: 'site-id',
};

function makeSitesQuery( overrides: Partial< SitesQueryResult > = {} ): SitesQueryResult {
	return {
		sites: [],
		total: 0,
		isLoading: false,
		isFetching: false,
		isSuccess: true,
		searchQuery: '',
		setSearchQuery: vi.fn(),
		refetch: vi.fn(),
		...overrides,
	};
}

const renderWithProvider = ( children: React.ReactElement ) =>
	render( <Provider store={ store }>{ children }</Provider> );

describe( 'SitesListContent', () => {
	beforeEach( () => {
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { openURL: vi.fn() } );
	} );

	it( 'shows localized empty message when search query yields no results', () => {
		renderWithProvider(
			<SitesListContent
				sitesQuery={ makeSitesQuery( { searchQuery: 'lorem ipsum' } ) }
				selectedSiteId={ null }
				onSelectSite={ vi.fn() }
			/>
		);
		expect( screen.getByText( 'No sites found for "lorem ipsum"' ) ).toBeInTheDocument();
	} );

	it( 'shows generic empty message when no search query is active', () => {
		renderWithProvider(
			<SitesListContent
				sitesQuery={ makeSitesQuery( { searchQuery: '' } ) }
				selectedSiteId={ null }
				onSelectSite={ vi.fn() }
			/>
		);
		expect(
			screen.getByText( 'No WordPress.com sites found on this account.' )
		).toBeInTheDocument();
	} );
} );

describe( 'SyncSitesModalSelector', () => {
	beforeEach( () => {
		store.dispatch( testActions.resetState() );
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			authenticate: vi.fn(),
			user: { id: 123, email: 'user@example.com', displayName: 'user' },
			client: {} as never,
		} );
		vi.mocked( useOffline ).mockReturnValue( false );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openURL: vi.fn(),
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
			updateConnectedWpcomSites: vi.fn().mockResolvedValue( undefined ),
		} );
		setWpcomClient( wpcomFactory( 'mock-token', wpcomXhrRequest ) );
		nock( 'https://public-api.wordpress.com' )
			.get( '/rest/v1.3/me/sites' )
			.query( true )
			.reply( 200, { sites: [], total: 0 } );
	} );

	afterEach( () => {
		setWpcomClient( undefined );
	} );

	it( 'shows "Find a perfect plan" modal when the account has no sites and no search is active', async () => {
		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				selectedSite={ selectedSite }
			/>
		);
		fireEvent.click( screen.getByText( 'WordPress.com / Pressable' ) );
		expect( await screen.findByText( 'Find a perfect plan' ) ).toBeInTheDocument();
	} );

	it( 'shows self-hosted connection fields from the site type chooser', async () => {
		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				selectedSite={ selectedSite }
			/>
		);

		fireEvent.click( screen.getByText( 'Connect an existing self-hosted site' ) );

		expect( await screen.findByLabelText( 'Site URL' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Environment type' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Sync mode' ) ).toBeInTheDocument();
	} );

	it( 'guides to connect an SSH server when provisioning with no SSH connections', async () => {
		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				selectedSite={ selectedSite }
			/>
		);

		fireEvent.click( screen.getByText( 'Provision a new site' ) );

		expect( await screen.findByText( 'No SSH-connected servers yet.' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Connect an SSH server' ) ).toBeInTheDocument();
	} );

	it( 'requests provisioning on a chosen SSH connection', async () => {
		const onProvisionRequested = vi.fn();
		const sshConnection = {
			id: 'conn-ssh',
			localSiteId: selectedSite.id,
			provider: 'self-hosted-ssh' as const,
			syncMode: 'ssh-wp-cli' as const,
			siteUrl: 'https://staging.example.com',
			environmentType: 'staging' as const,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
			capabilities: {
				canPull: true,
				canPush: true,
				canPushToProduction: false,
				canSyncContent: true,
				canSyncDatabase: true,
				canSyncFiles: true,
				requiresBackupBeforePush: true,
				requiresDryRunBeforeProductionPush: true,
			},
		};

		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				onProvisionRequested={ onProvisionRequested }
				sshConnections={ [ sshConnection ] }
				selectedSite={ selectedSite }
			/>
		);

		fireEvent.click( screen.getByText( 'Provision a new site' ) );
		fireEvent.click( await screen.findByText( 'https://staging.example.com' ) );

		expect( onProvisionRequested ).toHaveBeenCalledWith( sshConnection );
	} );
} );
