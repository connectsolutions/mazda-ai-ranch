import { Module } from '@nestjs/common';
import { McpServerController } from './mcpServer.controller';
import { IMcpServerGateway } from './domain/mcpServer.gateway';
import { McpServerSeeder } from './domain/mcpServer.seeder';
import { McpServerGateway } from './data/mcpServer.gateway';
import { McpServerMapper } from './data/mcpServer.mapper';
import { AuthModule } from '#/user/auth/auth.module';
import { SettingModule } from '#/setting/setting.module';

@Module({
  imports: [AuthModule, SettingModule],
  controllers: [McpServerController],
  providers: [
    McpServerMapper,
    McpServerSeeder,
    {
      provide: IMcpServerGateway,
      useClass: McpServerGateway,
    },
  ],
  exports: [IMcpServerGateway],
})
export class McpServerModule {}
