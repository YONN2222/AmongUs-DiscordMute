import { DataTypes, Model, type Sequelize } from "sequelize";

export class LinkModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare accountName: string;
    declare linkedAt: string;
    declare friendCode: string | null;
}

export function initLinkModel(sequelize: Sequelize): typeof LinkModel {
    class BoundLinkModel extends LinkModel {}
    BoundLinkModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
            accountName: { type: DataTypes.STRING, allowNull: false, field: "account_name" },
            linkedAt: { type: DataTypes.STRING, allowNull: false, field: "linked_at" },
            friendCode: { type: DataTypes.STRING, allowNull: true, field: "friend_code" },
        },
        { sequelize, tableName: "links", timestamps: false },
    );
    return BoundLinkModel;
}
