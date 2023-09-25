import {CodyResponse, Node, NodeType} from "@proophboard/cody-types";
import {ElementEditedContext, PlayConfigDispatch} from "@cody-play/infrastructure/cody/cody-message-server";
import {playUiMetadata} from "@cody-play/infrastructure/cody/ui/play-ui-metadata";
import {
  CodyResponseException,
  playwithErrorCheck
} from "@cody-play/infrastructure/cody/error-handling/with-error-check";
import {PlaySubLevelPage, PlayTopLevelPage} from "@cody-play/state/types";
import {playService} from "@cody-play/infrastructure/cody/service/play-service";
import {names} from "@event-engine/messaging/helpers";
import {playIsTopLevelPage} from "@cody-play/infrastructure/cody/ui/play-is-top-level-page";
import {CodyPlayConfig} from "@cody-play/state/config-store";
import {isQueryableStateDescription} from "@event-engine/descriptions/descriptions";
import {
  playGetNodeFromSyncedNodes,
  playGetSourcesOfType, playGetTargetsOfType
} from "@cody-play/infrastructure/cody/node-traversing/node-tree";
import {playVoMetadata} from "@cody-play/infrastructure/cody/vo/play-vo-metadata";
import {playVoFQCN} from "@cody-play/infrastructure/cody/schema/play-definition-id";

export const onUi = async (ui: Node, dispatch: PlayConfigDispatch, ctx: ElementEditedContext, config: CodyPlayConfig): Promise<CodyResponse> => {
  try {
    const meta = playwithErrorCheck(playUiMetadata, [ui, ctx]);

    const routeParams: string[] = meta.routeParams || [];
    const topLevelPage = playIsTopLevelPage(ui, meta, ctx, config.types);
    const route = meta.route || '/' + names(ui.getName()).fileName;

    const service = playwithErrorCheck(playService, [ui, ctx]);
    const serviceNames = names(service);
    const uiNames = names(ui.getName());

    const viewModels = playwithErrorCheck(playGetSourcesOfType, [ui, NodeType.document, true, true, true]);

    const views = viewModels.map(vM => {
      const syncedVm = playwithErrorCheck(playGetNodeFromSyncedNodes, [vM, ctx.syncedNodes]);
      const vMMeta = playwithErrorCheck(playVoMetadata, [syncedVm, ctx, config.types]);

      if(isQueryableStateDescription(vMMeta)) {
        if(!routeParams.includes(vMMeta.identifier)) {
          routeParams.push(vMMeta.identifier);
        }
      }

      return playwithErrorCheck(playVoFQCN, [syncedVm, vMMeta, ctx]);
    });

    const commands = playwithErrorCheck(playGetTargetsOfType, [ui, NodeType.command, true, true, true])
      .map(cmd => playwithErrorCheck(playGetNodeFromSyncedNodes, [cmd, ctx.syncedNodes]))
      .map(cmd => names(playwithErrorCheck(playService, [cmd, ctx])).className + '.' + names(cmd.getName()).className);


    const page = topLevelPage ? ({
      service: serviceNames.className,
      route,
      commands: commands.toArray(),
      components: views.toArray(),
      topLevel: topLevelPage,
      sidebar: meta.sidebar!,
      breadcrumb: meta.breadcrumb,
    } as PlayTopLevelPage) : ({
      service: serviceNames.className,
      route,
      routeParams,
      commands: commands.toArray(),
      components: views.toArray(),
      topLevel: false,
      breadcrumb: meta.breadcrumb
    } as PlaySubLevelPage);

    dispatch({
      type: "ADD_PAGE",
      page,
      name: names(ctx.boardName).className + '.' + uiNames.className
    })

    return {cody: `The UI page "${ui.getName()}" is added to the app.`}
  } catch (e) {
    if(e instanceof CodyResponseException) {
      return e.codyResponse;
    }

    throw e;
  }
}
