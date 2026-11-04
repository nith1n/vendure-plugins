import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoCustomFields1793799242398 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "collection" ADD "customFieldsAkeneocode" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" ADD CONSTRAINT "UQ_abf1eabff5cdd5258aec8aa6bbf" UNIQUE ("customFieldsAkeneocode")`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsAkeneocode" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD CONSTRAINT "UQ_868128a4de132f7fc30af6816c5" UNIQUE ("customFieldsAkeneocode")`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsAkeneouuid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD CONSTRAINT "UQ_c7283eb00b069445c4656c12291" UNIQUE ("customFieldsAkeneouuid")`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsAkeneocode" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD CONSTRAINT "UQ_236149a1989b24b62bb5b7e0669" UNIQUE ("customFieldsAkeneocode")`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsAkeneouuid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD CONSTRAINT "UQ_498db25fb075209884666626078" UNIQUE ("customFieldsAkeneouuid")`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product_variant" DROP CONSTRAINT "UQ_498db25fb075209884666626078"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsAkeneouuid"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "UQ_236149a1989b24b62bb5b7e0669"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsAkeneocode"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP CONSTRAINT "UQ_c7283eb00b069445c4656c12291"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsAkeneouuid"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP CONSTRAINT "UQ_868128a4de132f7fc30af6816c5"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsAkeneocode"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" DROP CONSTRAINT "UQ_abf1eabff5cdd5258aec8aa6bbf"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" DROP COLUMN "customFieldsAkeneocode"`, undefined);
   }

}
