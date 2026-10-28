import { DataTypes, Model, type Sequelize } from "sequelize";

export class MuteLedgerModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare mutedAt: number;
}

export function initMuteLedgerModel(sequelize: Sequelize): typeof MuteLedgerModel {
    class BoundMuteLedgerModel extends MuteLedgerModel {}
    BoundMuteLedgerModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
            mutedAt: { type: DataTypes.BIGINT, allowNull: false, field: "muted_at" },
        },
        { sequelize, tableName: "mute_ledger", timestamps: false },
    );
    return BoundMuteLedgerModel;
}
