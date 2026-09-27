import { DataTypes, Model } from "sequelize";
import { sequelize } from "./sequelize";

export class LinkModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare accountName: string;
    declare linkedAt: string;
}

LinkModel.init(
    {
        guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
        discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
        accountName: { type: DataTypes.STRING, allowNull: false, field: "account_name" },
        linkedAt: { type: DataTypes.STRING, allowNull: false, field: "linked_at" },
    },
    { sequelize, tableName: "links", timestamps: false },
);
