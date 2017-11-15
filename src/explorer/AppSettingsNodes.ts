/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import WebSiteManagementClient = require('azure-arm-website');
import * as WebSiteModels from 'azure-arm-website/lib/models';
import * as path from 'path';
import * as vscode from 'vscode';
import { SiteWrapper } from 'vscode-azureappservice';
import { IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureui';
import { nodeUtils } from '../utils/nodeUtils';

export class AppSettingsTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = 'applicationSettings';
    public readonly label: string = 'Application Settings';
    public readonly childTypeLabel: string = 'App Setting';
    public readonly contextValue: string = AppSettingsTreeItem.contextValue;
    private readonly _siteWrapper: SiteWrapper;
    private readonly _site: WebSiteModels.Site;
    private _settings: WebSiteModels.StringDictionary;

    constructor(site: WebSiteModels.Site) {
        this._siteWrapper = new SiteWrapper(site);
        this._site = site;
    }

    public get id(): string {
        return `${this._site.id}/application`;
    }

    public get iconPath(): { light: string, dark: string } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'AppSettings_color.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'AppSettings_color.svg')
        };
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(node: IAzureNode<AppSettingsTreeItem>): Promise<IAzureTreeItem[]> {
        const client: WebSiteManagementClient = nodeUtils.getWebSiteClient(node);
        this._settings = this._siteWrapper.slotName ?
            await client.webApps.listApplicationSettingsSlot(this._siteWrapper.resourceGroup, this._siteWrapper.name, this._siteWrapper.slotName) :
            await client.webApps.listApplicationSettings(this._siteWrapper.resourceGroup, this._siteWrapper.name);

        const treeItems: IAzureTreeItem[] = [];
        Object.keys(this._settings.properties).forEach((key: string) => {
            treeItems.push(new AppSettingTreeItem(key, this._settings.properties[key]));
        });

        return treeItems;
    }

    public async editSettingItem(client: WebSiteManagementClient, oldKey: string, newKey: string, value: string): Promise<void> {
        if (this._settings.properties) {
            if (oldKey !== newKey) {
                delete this._settings.properties[oldKey];
            }
            this._settings.properties[newKey] = value;
        }
        await this.applySettings(client);
    }

    public async deleteSettingItem(client: WebSiteManagementClient, key: string): Promise<void> {
        if (this._settings.properties) {
            delete this._settings.properties[key];
        }
        await this.applySettings(client);
    }

    public async createChild(node: IAzureNode<AppSettingsTreeItem>, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        if (!this._settings) {
            await this.loadMoreChildren(node);
        }

        const newKey = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: 'Enter new setting key',
            validateInput: v => this.validateNewKeyInput(v)
        });

        if (!newKey) {
            throw new UserCancelledError();
        }

        const newValue = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: `Enter setting value for "${newKey}"`
        }) || '';

        if (!this._settings.properties) {
            this._settings.properties = {};
        }

        showCreatingNode(newKey);
        this._settings.properties[newKey] = newValue;
        await this.applySettings(nodeUtils.getWebSiteClient(node));
        return new AppSettingTreeItem(newKey, newValue);
    }

    public validateNewKeyInput(newKey: string, oldKey?: string): string | undefined {
        newKey = newKey ? newKey.trim() : '';
        oldKey = oldKey ? oldKey.trim().toLowerCase() : oldKey;
        if (newKey.length === 0) {
            return 'Key must have at least one non-whitespace character.';
        }
        if (this._settings.properties && newKey.toLowerCase() !== oldKey) {
            for (const key of Object.keys(this._settings.properties)) {
                if (key.toLowerCase() === newKey.toLowerCase()) {
                    return `Setting "${newKey}" already exists.`;
                }
            }
        }

        return undefined;
    }

    private async applySettings(client: WebSiteManagementClient): Promise<WebSiteModels.StringDictionary> {
        return this._siteWrapper.slotName ?
            await client.webApps.updateApplicationSettingsSlot(this._siteWrapper.resourceGroup, this._siteWrapper.name, this._settings, this._siteWrapper.slotName) :
            await client.webApps.updateApplicationSettings(this._siteWrapper.resourceGroup, this._siteWrapper.name, this._settings);
    }
}

export class AppSettingTreeItem implements IAzureTreeItem {
    public static contextValue: string = 'applicationSettingItem';
    public readonly contextValue: string = AppSettingTreeItem.contextValue;

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        this.key = key;
        this.value = value;
    }

    public get id(): string {
        return this.key;
    }

    public get label(): string {
        return `${this.key}=${this.value}`;
    }

    public get iconPath(): { light: string, dark: string } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'Item_16x_vscode.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'Item_16x_vscode.svg')
        };
    }

    public async edit(node: IAzureNode): Promise<void> {
        const newValue = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: `Enter setting value for "${this.key}"`,
            value: this.value
        });

        if (newValue === undefined) {
            return;
        }

        this.value = newValue;
        await (<AppSettingsTreeItem>node.parent.treeItem).editSettingItem(nodeUtils.getWebSiteClient(node), this.key, this.key, newValue);
        node.refresh();
    }

    public async rename(node: IAzureNode): Promise<void> {
        const oldKey = this.key;
        const newKey = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: `Enter a new name for "${oldKey}"`,
            value: this.key,
            validateInput: v => (<AppSettingsTreeItem>node.parent.treeItem).validateNewKeyInput(v, oldKey)
        });

        if (!newKey) {
            return;
        }

        this.key = newKey;
        await (<AppSettingsTreeItem>node.parent.treeItem).editSettingItem(nodeUtils.getWebSiteClient(node), oldKey, newKey, this.value);
        node.refresh();
    }

    public async deleteTreeItem(node: IAzureNode): Promise<IAzureTreeItem> {
        const okayAction = 'Delete';
        const result = await vscode.window.showWarningMessage(`Are you sure you want to delete setting "${this.key}"?`, okayAction);

        if (result === okayAction) {
            await (<AppSettingsTreeItem>node.parent.treeItem).deleteSettingItem(nodeUtils.getWebSiteClient(node), this.key);
            return this;
        } else {
            throw new UserCancelledError();
        }
    }
}
