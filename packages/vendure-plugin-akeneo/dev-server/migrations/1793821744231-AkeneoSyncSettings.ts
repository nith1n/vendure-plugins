import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoSyncSettings1793821744231 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "collection" ADD "customFieldsAkeneochannelid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "channelCode" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "localeMapping" text NOT NULL DEFAULT '[]'`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "categoryTreeCodes" text NOT NULL DEFAULT '[]'`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "includeCategoryRoot" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" DROP CONSTRAINT "UQ_abf1eabff5cdd5258aec8aa6bbf"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_abf1eabff5cdd5258aec8aa6bb" ON "collection" ("customFieldsAkeneocode") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_61e002e46dae22059b5c36cb32" ON "collection" ("customFieldsAkeneochannelid") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_61e002e46dae22059b5c36cb32"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_abf1eabff5cdd5258aec8aa6bb"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" ADD CONSTRAINT "UQ_abf1eabff5cdd5258aec8aa6bbf" UNIQUE ("customFieldsAkeneocode")`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "includeCategoryRoot"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "categoryTreeCodes"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "localeMapping"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "channelCode"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" DROP COLUMN "customFieldsAkeneochannelid"`, undefined);
   }

}
