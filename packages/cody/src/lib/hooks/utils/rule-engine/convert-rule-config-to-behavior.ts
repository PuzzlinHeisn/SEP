import {
  AlwaysRule, ConditionRule,
  IfConditionRule,
  IfNotConditionRule, isExecuteRules,
  isIfConditionRule, isIfNotConditionRule, isRecordEvent,
  PropMapping,
  Rule, ThenExecuteRules,
  ThenRecordEvent
} from "./configuration";
import {CodyResponse, CodyResponseType, Node, NodeType} from "@proophboard/cody-types";
import {getTargetsOfType, isCodyError} from "@proophboard/cody-utils";
import {names} from "@event-engine/messaging/helpers";
import {detectService} from "../detect-service";
import {Context} from "../../context";

export interface Variable {
  name: string;
  initializer: string;
}

export const convertRuleConfigToAggregateBehavior = (aggregate: Node, ctx: Context, rules: Rule[], initialVariables: Variable[], indent = '  '): string | CodyResponse => {
  if(!rules.length) {
    return '';
  }

  const lines: string[] = [];

  lines.push(`${indent}const ctx: any = {};`);

  initialVariables.forEach(variable => lines.push(`${indent}ctx['${variable.name}'] = ${variable.initializer};`));

  for (const rule of rules) {
    lines.push("");
    const res = convertRule(aggregate, ctx, rule, lines, indent);
    if(isCodyError(res)) {
      return res;
    }
  }

  lines.push("");

  return lines.join("\n");
}

const convertRule = (aggregate: Node, ctx: Context, rule: Rule, lines: string[], indent = ''): boolean | CodyResponse => {
  switch (rule.rule) {
    case "always":
      return convertAlwaysRule(aggregate, ctx, rule, lines, indent);
    case "condition":
      return convertConditionRule(aggregate, ctx, rule as ConditionRule, lines, indent);
    default:
      return {
        cody: `I don't know how to handle a rule of type "${rule.rule}".`,
        type: CodyResponseType.Error,
        details: `Looks like a typo on your side. I can handle the following rule types: always, condition, validate`
      }
  }
}

const convertAlwaysRule = (aggregate: Node, ctx: Context, rule: AlwaysRule, lines: string[], indent = ''): boolean | CodyResponse => {
  return convertThen(aggregate, ctx, rule, lines, indent);
}

const convertConditionRule = (node: Node, ctx: Context, rule: ConditionRule, lines: string[], indent = ''): boolean | CodyResponse => {
  let ifCondition: string, expr: string;

  if(isIfConditionRule(rule)) {
    ifCondition = 'if (';
    expr = rule.if;
  } else if(isIfNotConditionRule(rule)) {
    ifCondition = 'if (!';
    expr = rule.if_not;
  } else {
    return {
      cody: `I don't know how to handle a condition rule that neither has an "if" nor a "if_not" condition defined: "${JSON.stringify(rule)}".`,
      type: CodyResponseType.Error,
      details: `Looks like a mistake on your side. Please check the rules of ${node.getType()}: "${node.getName()}"`
    }
  }

  lines.push(`${indent}${ifCondition}(${wrapExpression(expr)})) {`);

  const then = convertThen(node, ctx, rule, lines, indent + '  ');

  if(isCodyError(then)) {
    return then;
  }

  if(rule.stop) {
    lines.push(`${indent}  return;`)
  }

  lines.push(`${indent}}`);

  return true;
}

const convertThen = (node: Node, ctx: Context, rule: Rule, lines: string[], indent = ''): boolean | CodyResponse => {
  const {then} = rule;
  switch (true) {
    case isRecordEvent(then):
      return convertThenRecordEvent(node, ctx, then as ThenRecordEvent, rule, lines, indent);
    case isExecuteRules(then):
      return convertThenExecuteRules(node, ctx, then as ThenExecuteRules, rule, lines, indent);
    default:
      return {
        cody: `I don't know the "then" part of that rule: ${JSON.stringify(rule)}.`,
        type: CodyResponseType.Error,
        details: `Looks like a typo on your side. I can only perform the actions: record: event, throw: error, assign: variable, trigger: command, perform: query, execute: rules`,
      }
  }
}

const convertThenRecordEvent = (node: Node, ctx: Context, then: ThenRecordEvent, rule: Rule, lines: string[], indent = ''): boolean | CodyResponse => {
  const aggregateNames = names(node.getName());
  const service = detectService(node, ctx);
  if(isCodyError(service)) {
    return service;
  }

  const eventNameParts = then.record.event.split(".");
  const eventNames = names(then.record.event);

  if(eventNameParts.length > 1) {
    return {
      cody: `Please don't use a dot in the event name of a record:event rule. I found one in the rule: ${JSON.stringify(rule)} of aggregate "${node.getName()}"`,
      type: CodyResponseType.Error,
      details: `You don't have to provide the full event name including service and aggregate. I'm using service "${service}" and aggregate name: "${node.getName()}" for that event.`
    }
  }

  const events = getTargetsOfType(node, NodeType.event, true);
  if(isCodyError(events)) {
    return events;
  }

  let eventExists = false;

  events.forEach(evt => {
    if(names(evt.getName()).className === eventNames.className) {
      eventExists = true;
    }
  });

  if(!eventExists) {
    return {
      cody: `The event "${then.record.event}" specified in the rule: ${JSON.stringify(rule)} of aggregate "${node.getName()}" is not known for that aggregate`,
      type: CodyResponseType.Error,
      details: `An aggregate can only record events that are connected to it with an arrow pointing from the aggregate to the event.`
    }
  }

  const mapping = convertMapping(node, ctx, then.record.mapping, rule, indent);
  if(isCodyError(mapping)) {
    return mapping;
  }

  lines.push(`${indent}yield ${eventNames.propertyName}(${mapping});`);
}

const convertThenExecuteRules = (node: Node, ctx: Context, then: ThenExecuteRules, rule: Rule, lines: string[], indent = ''): boolean | CodyResponse => {
  for (const r of then.execute.rules) {
    const success = convertRule(node, ctx, r, lines, indent);

    if(isCodyError(success)) {
      return success;
    }
  }

  return true;
}

const convertMapping = (node: Node, ctx: Context, mapping: string | PropMapping, rule: Rule, indent = ''): string | CodyResponse => {
  if(typeof mapping === "string") {
    return wrapExpression(mapping);
  }

  let propMap = `{\n`;

  for (const propName in mapping) {
    propMap += `${indent}  "${propName}": ${wrapExpression(mapping[propName])},\n`
  }

  propMap += `${indent}}`;

  return propMap;
}

const wrapExpression = (expr: string): string => {
  return `await jexl.eval("${expr}", ctx)`;
}