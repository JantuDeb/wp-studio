import { __experimentalHeading as Heading } from '@wordpress/components';
import { sprintf, __ } from '@wordpress/i18n';
import { ReactNode } from 'react';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';

type SyncDialogShellProps = {
	title: string;
	description: ReactNode;
	/** Display name/label of the sync source (e.g. local site name or remote URL). */
	sourceName: ReactNode;
	/** Display name/label of the sync destination. */
	destinationName: ReactNode;
	/** Plain-text source name for the screen-reader summary. */
	sourceNameText: string;
	/** Plain-text destination name for the screen-reader summary. */
	destinationNameText: string;
	/** Upper-case section heading above the selection area (e.g. "Select data to pull"). */
	selectionHeading: string;
	/** The provider-specific selection UI (tree, content list, etc.). */
	children: ReactNode;
	/** The pinned footer (warnings + action buttons). Rendered at the bottom of the modal. */
	footer: ReactNode;
	/** Bottom padding for the scroll area so content is not hidden behind the pinned footer. */
	bottomPadding?: number | string;
	onRequestClose: () => void;
};

/**
 * Provider-neutral shell for the sync dialogs (WordPress.com and self-hosted).
 *
 * It owns only the shared chrome — the modal frame, description, the from→to header with its
 * screen-reader summary, the upper-case section heading, the scroll container, and the pinned
 * footer slot. All provider-specific data loading and selection UI is passed in via `children` and
 * `footer`, so each dialog keeps its own behavior while sharing one consistent layout.
 */
export function SyncDialogShell( {
	title,
	description,
	sourceName,
	destinationName,
	sourceNameText,
	destinationNameText,
	selectionHeading,
	children,
	footer,
	bottomPadding,
	onRequestClose,
}: SyncDialogShellProps ) {
	return (
		<Modal
			className="w-3/5 min-w-[550px] max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ title }
		>
			<div style={ { paddingBottom: bottomPadding } }>
				<div className="px-8 pb-6 pt-1">{ description }</div>
				<div className="px-8">
					<span className="sr-only">
						{ /* translators: %1$s is the source site name, %2$s is the destination site name */ }
						{ sprintf( __( 'From %1$s to %2$s' ), sourceNameText, destinationNameText ) }
					</span>
					<div
						aria-hidden="true"
						className="flex max-w-full overflow-hidden pb-6 border-b border-frame-border"
					>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">{ sourceName }</div>
						</div>
						<div className="w-[50px] flex items-center justify-center text-frame-text-secondary">
							<RightArrowIcon />
						</div>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">{ destinationName }</div>
						</div>
					</div>
				</div>
				<Heading
					level={ 2 }
					lineHeight="28px"
					size={ 11 }
					weight={ 500 }
					upperCase
					className="px-8 pt-5 pb-3"
				>
					{ selectionHeading }
				</Heading>
				{ children }
				<div className="px-8 py-4 absolute left-0 right-0 bottom-0 bg-frame z-10 border-t border-frame-border">
					{ footer }
				</div>
			</div>
		</Modal>
	);
}
