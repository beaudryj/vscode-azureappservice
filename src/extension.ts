/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { ErrorData } from './ErrorData';
import { SiteActionError, UserCancelledError, WizardFailedError } from './errors';
import { AppServiceDataProvider } from './explorer/AppServiceExplorer';
import { AppServiceNode } from './explorer/AppServiceNode';
import { AppSettingNode, AppSettingsNode } from './explorer/AppSettingsNodes';
import { DeploymentSlotNode } from './explorer/DeploymentSlotNode';
import { DeploymentSlotsNode } from './explorer/DeploymentSlotsNode';
import { NodeBase } from './explorer/NodeBase';
import { SiteNodeBase } from './explorer/SiteNodeBase';
import { SubscriptionNode } from './explorer/SubscriptionNode';
import { Reporter } from './telemetry/reporter';
import * as util from "./util";
import { WebAppCreator } from './WebAppCreator2';
import { WebAppZipPublisher } from './WebAppZipPublisher';

// tslint:disable-next-line:max-func-body-length
export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(new Reporter(context));

    const outputChannel = util.getOutputChannel();
    context.subscriptions.push(outputChannel);

    const azureAccount = new AzureAccountWrapper(context);
    const appServiceDataProvider = new AppServiceDataProvider(azureAccount);

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureAppService', appServiceDataProvider));

    initCommand(context, 'appService.Refresh', (node?: NodeBase) => appServiceDataProvider.refresh(node));
    initCommand(context, 'appService.Browse', (node: SiteNodeBase) => {
        if (node) {
            node.browse();
        }
    });
    initCommand(context, 'appService.OpenInPortal', (node: NodeBase) => {
        if (node && node.openInPortal) {
            node.openInPortal();
        }
    });
    initAsyncCommand(context, 'appService.Start', async (node: SiteNodeBase) => {
        if (node) {
            const siteType = util.isSiteDeploymentSlot(node.site) ? 'Deployment Slot' : 'Web App';
            outputChannel.show();
            outputChannel.appendLine(`Starting ${siteType} "${node.site.name}"...`);
            await node.start();
            outputChannel.appendLine(`${siteType} "${node.site.name}" has been started.`);
        }
    });
    initAsyncCommand(context, 'appService.Stop', async (node: SiteNodeBase) => {
        if (node) {
            const siteType = util.isSiteDeploymentSlot(node.site) ? 'Deployment Slot' : 'Web App';
            outputChannel.show();
            outputChannel.appendLine(`Stopping ${siteType} "${node.site.name}"...`);
            await node.stop();
            outputChannel.appendLine(`${siteType} "${node.site.name}" has been stopped. App Service plan charges still apply.`);

        }
    });
    initAsyncCommand(context, 'appService.Restart', async (node: SiteNodeBase) => {
        if (node) {
            const siteType = util.isSiteDeploymentSlot(node.site) ? 'Deployment Slot' : 'Web App';
            outputChannel.show();
            outputChannel.appendLine(`Restarting ${siteType} "${node.site.name}"...`);
            await node.restart();
            outputChannel.appendLine(`${siteType} "${node.site.name}" has been restarted.`);

        }
    });
    initAsyncCommand(context, 'appService.Delete', async (node: SiteNodeBase) => {
        const yes = 'Yes';
        if (node) {
            if (await vscode.window.showWarningMessage(`Are you sure you want to delete "${node.site.name}"?`, yes) === yes) {
                outputChannel.appendLine(`Deleting app "${node.site.name}"...`);
                await node.delete();
                outputChannel.appendLine(`App "${node.site.name}" has been deleted.`);
                vscode.commands.executeCommand('appService.Refresh', node.getParentNode());
            } else {
                throw new UserCancelledError();
            }
        }
    });
    initAsyncCommand(context, 'appService.CreateWebApp', async (node?: SubscriptionNode) => {
        let subscription;
        if (node) {
            subscription = node.subscription;
        }
        const wizard = new WebAppCreator(outputChannel, azureAccount, subscription, context.globalState);
        const result = await wizard.run();
        if (result.status === 'Completed') {
            vscode.commands.executeCommand('appService.Refresh', node);
        }
    });
    initAsyncCommand(context, 'appService.DeployZipPackage', async (target?: {}) => {
        if (target instanceof SiteNodeBase) {
            const wizard = new WebAppZipPublisher(outputChannel, azureAccount, target.subscription, target.site);
            await wizard.run();
        } else if (target instanceof vscode.Uri) {
            const wizard = new WebAppZipPublisher(outputChannel, azureAccount, undefined, undefined, target.fsPath);
            await wizard.run();
        }
    });
    initAsyncCommand(context, 'appService.ZipAndDeploy', async (uri?: {}) => {
        if (uri instanceof vscode.Uri) {
            const folderPath = uri.fsPath;
            const wizard = new WebAppZipPublisher(outputChannel, azureAccount, undefined, undefined, folderPath);
            await wizard.run();
        }
    });
    initAsyncCommand(context, 'appService.LocalGitDeploy', async (node?: SiteNodeBase) => {
        if (node) {
            outputChannel.appendLine(`Deploying Local Git repository to "${node.site.name}"...`);
            await node.localGitDeploy();
            outputChannel.appendLine(`Local repository has been deployed to "${node.site.name}".`);
        }
    });
    initAsyncCommand(context, 'appService.OpenVSTSCD', async (node?: AppServiceNode) => {
        if (node) {
            node.openCdInPortal();
        }
    });
    initAsyncCommand(context, 'appService.DeploymentScript', async (node: AppServiceNode) => {
        if (node) {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, p => {
                p.report({ message: 'Generating script...' });
                return node.generateDeploymentScript();
            });
        }
    });
    initAsyncCommand(context, 'appService.EditScmType', async (node: AppServiceNode) => {
        if (node) {
            const updatedScmType = await node.editScmType();
            outputChannel.appendLine(`Deployment source for "${node.site.name}" has been updated to "${updatedScmType}".`);
        }
    });
    initAsyncCommand(context, 'deploymentSlots.CreateSlot', async (node: DeploymentSlotsNode) => {
        if (node) {
            const newSlot = await node.createNewDeploymentSlot();
            vscode.commands.executeCommand('appService.Refresh', node);
            outputChannel.appendLine(`Successfully created deployment slot "${newSlot}" for web app "${node.getParentNode().label}".`);

        }
    });
    initAsyncCommand(context, 'deploymentSlot.SwapSlots', async (node: DeploymentSlotNode) => {
        if (node) {
            await node.swapDeploymentSlots(outputChannel);
        }
    });
    initAsyncCommand(context, 'appSettings.Add', async (node: AppSettingsNode) => {
        if (node) {
            await node.addSettingItem();
        }
    });
    initAsyncCommand(context, 'appSettings.Edit', async (node: AppSettingNode) => {
        if (node) {
            await node.edit();
        }
    });
    initAsyncCommand(context, 'appSettings.Rename', async (node: AppSettingNode) => {
        if (node) {
            await node.rename();
        }
    });
    initAsyncCommand(context, 'appSettings.Delete', async (node: AppSettingNode) => {
        if (node) {
            await node.delete();
        }
    });
    initAsyncCommand(context, 'diagnostics.OpenLogStream', async (node: SiteNodeBase) => {
        if (node) {
            const enableButton = 'Yes';
            const isEnabled = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, p => {
                p.report({ message: 'Checking container diagnostics settings...' });
                return node.isHttpLogsEnabled();
            });

            if (!isEnabled && enableButton === await vscode.window.showWarningMessage('Do you want to enable logging and restart this container?', enableButton)) {
                outputChannel.show();
                outputChannel.appendLine(`Enabling Logging for "${node.site.name}"...`);
                await node.enableHttpLogs();
                await vscode.commands.executeCommand('appService.Restart', node);
            }
            // Otherwise connect to log stream anyways, users might see similar "log not enabled" message with how to enable link from the stream output.
            await node.connectToLogStream(context);
        }
    });
    initCommand(context, 'diagnostics.StopLogStream', (node: SiteNodeBase) => {
        if (node) {
            node.stopLogStream();
        }
    });
}

// tslint:disable-next-line:no-empty
export function deactivate(): void {
}

function initCommand<T>(extensionContext: vscode.ExtensionContext, commandId: string, callback: (context?: T) => void): void {
    initAsyncCommand(extensionContext, commandId, async (context?: T) => callback(context));
}

function initAsyncCommand<T>(extensionContext: vscode.ExtensionContext, commandId: string, callback: (context?: T) => Promise<void>): void {
    extensionContext.subscriptions.push(vscode.commands.registerCommand(commandId, async (...args: {}[]) => {
        const start = Date.now();
        const properties: { [key: string]: string; } = {};
        const output = util.getOutputChannel();
        properties.result = 'Succeeded';
        let errorData: ErrorData | undefined;

        try {
            if (args.length === 0) {
                await callback();
            } else {
                await callback(<T>args[0]);
            }
        } catch (err) {
            if (err instanceof SiteActionError) {
                properties.servicePlan = err.servicePlanSize;
            }

            if (err instanceof WizardFailedError) {
                properties.stepTitle = err.stepTitle;
                properties.stepIndex = err.stepIndex.toString();
            }

            if (err instanceof UserCancelledError) {
                properties.result = 'Canceled';
            } else {
                properties.result = 'Failed';
                errorData = new ErrorData(err);
                output.appendLine(`Error: ${errorData.message}`);
                if (errorData.message.includes('\n')) {
                    output.show();
                    vscode.window.showErrorMessage('An error has occured. Check output window for more details.');
                } else {
                    vscode.window.showErrorMessage(errorData.message);
                }

            }
        } finally {
            if (errorData) {
                properties.error = errorData.errorType;
                properties.errorMessage = errorData.message;
            }
            const end = Date.now();
            util.sendTelemetry(commandId, properties, { duration: (end - start) / 1000 });
        }
    }));
}
