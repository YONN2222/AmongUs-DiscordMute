import { DataTypes, Model, type Sequelize } from "sequelize";

export class PairingCodeModel extends Model {
    declare guildId: string;
    declare guildName: string;
    declare code: string;
    declare expiresAt: number;
}

export function initPairingCodeModel(sequelize: Sequelize): typeof PairingCodeModel {
    class BoundPairingCodeModel extends PairingCodeModel {}
    BoundPairingCodeModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            guildName: { type: DataTypes.STRING, allowNull: false, field: "guild_name" },
            code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
            expiresAt: { type: DataTypes.BIGINT, allowNull: false, field: "expires_at" },
        },
        { sequelize, tableName: "pairing_codes", timestamps: false },
    );
    return BoundPairingCodeModel;
}
