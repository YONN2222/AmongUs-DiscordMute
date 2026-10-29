import { DataTypes, Model, type Sequelize } from "sequelize";

export class MuteLedgerModel extends Model {
    declare guildId: string;
    declare discordId: string;
    declare mutedAt: number;
    declare muted: number;
    declare deafened: number;
    declare sessionId: string | null;
}

export function initMuteLedgerModel(sequelize: Sequelize): typeof MuteLedgerModel {
    class BoundMuteLedgerModel extends MuteLedgerModel {}
    BoundMuteLedgerModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            discordId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "discord_id" },
            mutedAt: { type: DataTypes.BIGINT, allowNull: false, field: "muted_at" },
            muted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
            deafened: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
            sessionId: { type: DataTypes.STRING(64), allowNull: true, field: "session_id" },
        },
        { sequelize, tableName: "mute_ledger", timestamps: false },
    );
    return BoundMuteLedgerModel;
}
