import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoFamilyMapping1793952976210 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "syncImages" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" ADD "familyOverrides" text NOT NULL DEFAULT '[]'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "familyOverrides"`, undefined);
        await queryRunner.query(`ALTER TABLE "akeneo_connection_settings" DROP COLUMN "syncImages"`, undefined);
   }

}
