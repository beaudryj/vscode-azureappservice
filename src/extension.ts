/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import WebSiteManagementClient = require('azure-arm-website');
import * as vscode from 'vscode';
import { AzureExplorer, IAzureNode, IAzureParentNode, UserCancelledError } from 'vscode-azureui';
import { DeploymentSlotSwapper } from './DeploymentSlotSwapper';
import { ErrorData } from './ErrorData';
import { SiteActionError, WizardFailedError } from './errors';
import { WebAppTreeItem } from './explorer/AppServiceNode';
import { AppSettingsTreeItem, AppSettingTreeItem } from './explorer/AppSettingsNodes';
import { DeploymentSlotTreeItem } from './explorer/DeploymentSlotNode';
import { DeploymentSlotsTreeItem } from './explorer/DeploymentSlotsNode';
import { SiteTreeItem } from './explorer/SiteNodeBase';
import { WebAppProvider } from './explorer/SubscriptionNode';
import { Reporter } from './telemetry/reporter';
import * as util from "./util";
import { nodeUtils } from './utils/nodeUtils';

// tslint:disable-next-line:max-func-body-length
export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(new Reporter(context));

    const outputChannel = util.getOutputChannel();
    context.subscriptions.push(outputChannel);

    const webAppProvider: WebAppProvider = new WebAppProvider(context.globalState);
    const appServiceExplorer = new AzureExplorer(webAppProvider, 'appService.LoadMore');
    context.subscriptions.push(appServiceExplorer);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureAppService', appServiceExplorer));

    initCommand(context, 'appService.Refresh', (node?: IAzureNode) => appServiceExplorer.refresh(node));
    initCommand(context, 'appService.LoadMore', (node?: IAzureNode) => appServiceExplorer.loadMore(node));
    initAsyncCommand(context, 'appService.Browse', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        node.treeItem.browse();
    });
    initAsyncCommand(context, 'appService.OpenInPortal', async (node: IAzureNode) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        node.openInPortal();
    });
    initAsyncCommand(context, 'appService.Start', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        const siteType = util.isSiteDeploymentSlot(node.treeItem.site) ? 'Deployment Slot' : 'Web App';
        outputChannel.show();
        outputChannel.appendLine(`Starting ${siteType} "${node.treeItem.site.name}"...`);
        await node.treeItem.siteWrapper.start(nodeUtils.getWebSiteClient(node));
        outputChannel.appendLine(`${siteType} "${node.treeItem.site.name}" has been started.`);
    });
    initAsyncCommand(context, 'appService.Stop', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        const siteType = util.isSiteDeploymentSlot(node.treeItem.site) ? 'Deployment Slot' : 'Web App';
        outputChannel.show();
        outputChannel.appendLine(`Stopping ${siteType} "${node.treeItem.site.name}"...`);
        await node.treeItem.siteWrapper.stop(nodeUtils.getWebSiteClient(node));
        outputChannel.appendLine(`${siteType} "${node.treeItem.site.name}" has been stopped. App Service plan charges still apply.`);
    });
    initAsyncCommand(context, 'appService.Restart', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        const client: WebSiteManagementClient = nodeUtils.getWebSiteClient(node);
        const siteType = util.isSiteDeploymentSlot(node.treeItem.site) ? 'Deployment Slot' : 'Web App';
        outputChannel.show();
        outputChannel.appendLine(`Restarting ${siteType} "${node.treeItem.site.name}"...`);
        await node.treeItem.siteWrapper.stop(client);
        await node.treeItem.siteWrapper.start(client);
        outputChannel.appendLine(`${siteType} "${node.treeItem.site.name}" has been restarted.`);

    });
    initAsyncCommand(context, 'appService.Delete', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        await node.deleteNode();
    });
    initAsyncCommand(context, 'appService.CreateWebApp', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await appServiceExplorer.showNodePicker(AzureExplorer.subscriptionContextValue);
        }

        await node.createChild();
    });
    initAsyncCommand(context, 'appService.DeployZipPackage', async (target?: vscode.Uri | IAzureNode<WebAppTreeItem> | undefined) => {
        let node: IAzureNode<WebAppTreeItem>;
        let fsPath: string;
        if (target instanceof vscode.Uri) {
            fsPath = target.fsPath;
        } else {
            fsPath = (await util.showWorkspaceFoldersQuickPick("Select the folder to deploy")).uri.fsPath;
            node = target;
        }

        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        await node.treeItem.siteWrapper.deployZip(fsPath, nodeUtils.getWebSiteClient(node), outputChannel);
    });
    initAsyncCommand(context, 'appService.LocalGitDeploy', async (node?: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        outputChannel.appendLine(`Deploying Local Git repository to "${node.treeItem.site.name}"...`);
        await node.treeItem.localGitDeploy(nodeUtils.getWebSiteClient(node));
        outputChannel.appendLine(`Local repository has been deployed to "${node.treeItem.site.name}".`);
    });
    initAsyncCommand(context, 'appService.OpenVSTSCD', async (node?: IAzureNode<WebAppTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        node.treeItem.openCdInPortal(node);
    });
    initAsyncCommand(context, 'appService.DeploymentScript', async (node: IAzureNode<WebAppTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, p => {
            p.report({ message: 'Generating script...' });
            return node.treeItem.generateDeploymentScript(node);
        });
    });
    initAsyncCommand(context, 'deploymentSlots.CreateSlot', async (node: IAzureParentNode<DeploymentSlotsTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<DeploymentSlotsTreeItem>>await appServiceExplorer.showNodePicker(DeploymentSlotsTreeItem.contextValue);
        }

        await node.createChild();
    });
    initAsyncCommand(context, 'deploymentSlot.SwapSlots', async (node: IAzureNode<DeploymentSlotTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<DeploymentSlotTreeItem>>await appServiceExplorer.showNodePicker(DeploymentSlotTreeItem.contextValue);
        }

        const wizard = new DeploymentSlotSwapper(outputChannel, node);
        await wizard.run();
    });
    initAsyncCommand(context, 'appSettings.Add', async (node: IAzureParentNode<AppSettingsTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<AppSettingsTreeItem>>await appServiceExplorer.showNodePicker(AppSettingsTreeItem.contextValue);
        }

        await node.createChild();
    });
    initAsyncCommand(context, 'appSettings.Edit', async (node: IAzureNode<AppSettingTreeItem>) => {
        if (!node) {
            node = <IAzureNode<AppSettingTreeItem>>await appServiceExplorer.showNodePicker(AppSettingTreeItem.contextValue);
        }

        await node.treeItem.edit(node);
    });
    initAsyncCommand(context, 'appSettings.Rename', async (node: IAzureNode<AppSettingTreeItem>) => {
        if (!node) {
            node = <IAzureNode<AppSettingTreeItem>>await appServiceExplorer.showNodePicker(AppSettingTreeItem.contextValue);
        }

        await node.treeItem.rename(node);
    });
    initAsyncCommand(context, 'appSettings.Delete', async (node: IAzureNode<AppSettingTreeItem>) => {
        if (!node) {
            node = <IAzureNode<AppSettingTreeItem>>await appServiceExplorer.showNodePicker(AppSettingTreeItem.contextValue);
        }

        await node.deleteNode();
    });
    initAsyncCommand(context, 'diagnostics.OpenLogStream', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        const client: WebSiteManagementClient = nodeUtils.getWebSiteClient(node);
        const enableButton = 'Yes';
        const isEnabled = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, p => {
            p.report({ message: 'Checking container diagnostics settings...' });
            return node.treeItem.isHttpLogsEnabled(client);
        });

        if (!isEnabled && enableButton === await vscode.window.showWarningMessage('Do you want to enable logging and restart this container?', enableButton)) {
            outputChannel.show();
            outputChannel.appendLine(`Enabling Logging for "${node.treeItem.site.name}"...`);
            await node.treeItem.enableHttpLogs(client);
            await vscode.commands.executeCommand('appService.Restart', node);
        }
        // Otherwise connect to log stream anyways, users might see similar "log not enabled" message with how to enable link from the stream output.
        await node.treeItem.connectToLogStream(client, context);
    });
    initAsyncCommand(context, 'diagnostics.StopLogStream', async (node: IAzureNode<SiteTreeItem>) => {
        if (!node) {
            node = <IAzureNode<WebAppTreeItem>>await appServiceExplorer.showNodePicker(WebAppTreeItem.contextValue);
        }

        node.treeItem.stopLogStream();
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
