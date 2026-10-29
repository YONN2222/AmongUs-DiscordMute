import { DataTypes, Model, type Sequelize } from "sequelize";

export class NicknameLedgerModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare originalNick: string | null;
    declare appliedNick: string;
}

export function initNicknameLedgerModel(sequelize: Sequelize): typeof NicknameLedgerModel {
    class BoundNicknameLedgerModel extends NicknameLedgerModel {}
    BoundNicknameLedgerModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
            originalNick: { type: DataTypes.STRING, allowNull: true, field: "original_nick" },
            appliedNick: { type: DataTypes.STRING, allowNull: false, field: "applied_nick" },
        },
        { sequelize, tableName: "nickname_ledger", timestamps: false },
    );
    return BoundNicknameLedgerModel;
}
