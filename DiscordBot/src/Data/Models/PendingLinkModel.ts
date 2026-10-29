import { DataTypes, Model, type Sequelize } from "sequelize";

export class PendingLinkModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare phrase: string;
    declare quickChatCode: string;
    declare quickChatIds: string;
    declare expiresAt: number;
    declare applicationId: string | null;
    declare interactionToken: string | null;
    declare locale: string | null;
}

export function initPendingLinkModel(sequelize: Sequelize): typeof PendingLinkModel {
    class BoundPendingLinkModel extends PendingLinkModel {}
    BoundPendingLinkModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
            phrase: { type: DataTypes.STRING, allowNull: false, unique: true },
            quickChatCode: { type: DataTypes.STRING, allowNull: false, unique: true, field: "quick_chat_code" },
            quickChatIds: { type: DataTypes.STRING, allowNull: false, field: "quick_chat_ids" },
            expiresAt: { type: DataTypes.BIGINT, allowNull: false, field: "expires_at" },
            applicationId: { type: DataTypes.TEXT, allowNull: true, field: "application_id" },
            interactionToken: { type: DataTypes.TEXT, allowNull: true, field: "interaction_token" },
            locale: { type: DataTypes.TEXT, allowNull: true },
        },
        { sequelize, tableName: "pending_links", timestamps: false },
    );
    return BoundPendingLinkModel;
}
