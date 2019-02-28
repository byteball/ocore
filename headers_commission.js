/*jslint node: true */
"use strict";
var crypto = require('crypto');
var async = require('async');
var db = require('./db.js');
var conf = require('./conf.js');
var _ = require('lodash');
var storage = require('./storage.js');

var max_spendable_mci = null;

function calcHeadersCommissions(conn, onDone){
	// we don't require neither source nor recipient to be majority witnessed -- we don't want to return many times to the same MC index.
	console.log("will calc h-comm");
	if (max_spendable_mci === null) // first calc after restart only
		return initMaxSpendableMci(conn, function(){ calcHeadersCommissions(conn, onDone); });
	
	// max_spendable_mci is old, it was last updated after previous calc
	var since_mc_index = max_spendable_mci;
		
	async.series([
		function(cb){
			if (conf.storage === 'mysql'){
				var best_child_sql = "SELECT unit \n\
					FROM parenthoods \n\
					JOIN units AS alt_child_units ON parenthoods.child_unit=alt_child_units.unit \n\
					WHERE parent_unit=punits.unit AND alt_child_units.main_chain_index-punits.main_chain_index<=1 AND +alt_child_units.sequence='good' \n\
					ORDER BY SHA1(CONCAT(alt_child_units.unit, next_mc_units.unit)) \n\
					LIMIT 1";
				// headers commissions to single unit author
				conn.query(
					"INSERT INTO headers_commission_contributions (unit, address, amount) \n\
					SELECT punits.unit, address, punits.headers_commission AS hc \n\
					FROM units AS chunits \n\
					JOIN unit_authors USE INDEX(PRIMARY) USING(unit) \n\
					JOIN parenthoods ON chunits.unit=parenthoods.child_unit \n\
					JOIN units AS punits ON parenthoods.parent_unit=punits.unit \n\
					JOIN units AS next_mc_units ON next_mc_units.is_on_main_chain=1 AND next_mc_units.main_chain_index=punits.main_chain_index+1 \n\
					WHERE chunits.is_stable=1 \n\
						AND +chunits.sequence='good' \n\
						AND punits.main_chain_index>? \n\
						AND chunits.main_chain_index-punits.main_chain_index<=1 \n\
						AND +punits.sequence='good' \n\
						AND punits.is_stable=1 \n\
						AND next_mc_units.is_stable=1 \n\
						AND chunits.unit=( "+best_child_sql+" ) \n\
						AND (SELECT COUNT(*) FROM unit_authors WHERE unit=chunits.unit)=1 \n\
						AND (SELECT COUNT(*) FROM earned_headers_commission_recipients WHERE unit=chunits.unit)=0 \n\
					UNION ALL \n\
					SELECT punits.unit, earned_headers_commission_recipients.address, \n\
						ROUND(punits.headers_commission*earned_headers_commission_share/100.0) AS hc \n\
					FROM units AS chunits \n\
					JOIN earned_headers_commission_recipients USING(unit) \n\
					JOIN parenthoods ON chunits.unit=parenthoods.child_unit \n\
					JOIN units AS punits ON parenthoods.parent_unit=punits.unit \n\
					JOIN units AS next_mc_units ON next_mc_units.is_on_main_chain=1 AND next_mc_units.main_chain_index=punits.main_chain_index+1 \n\
					WHERE chunits.is_stable=1 \n\
						AND +chunits.sequence='good' \n\
						AND punits.main_chain_index>? \n\
						AND chunits.main_chain_index-punits.main_chain_index<=1 \n\
						AND +punits.sequence='good' \n\
						AND punits.is_stable=1 \n\
						AND next_mc_units.is_stable=1 \n\
						AND chunits.unit=( "+best_child_sql+" )", 
					[since_mc_index, since_mc_index], 
					function(){ cb(); }
				);
			}
			else{ // there is no SHA1 in sqlite, have to do it in js
				conn.cquery(
					// chunits is any child unit and contender for headers commission, punits is hc-payer unit
					"SELECT chunits.unit AS child_unit, punits.headers_commission, next_mc_units.unit AS next_mc_unit, punits.unit AS payer_unit \n\
					FROM units AS chunits \n\
					JOIN parenthoods ON chunits.unit=parenthoods.child_unit \n\
					JOIN units AS punits ON parenthoods.parent_unit=punits.unit \n\
					JOIN units AS next_mc_units ON next_mc_units.is_on_main_chain=1 AND next_mc_units.main_chain_index=punits.main_chain_index+1 \n\
					WHERE chunits.is_stable=1 \n\
						AND +chunits.sequence='good' \n\
						AND punits.main_chain_index>? \n\
						AND +punits.sequence='good' \n\
						AND punits.is_stable=1 \n\
						AND chunits.main_chain_index-punits.main_chain_index<=1 \n\
						AND next_mc_units.is_stable=1", 
					[since_mc_index],
					function(rows){
						// in-memory
						var assocChildrenInfosRAM = {};
						var arrParentUnits = storage.assocStableUnitsByMci[since_mc_index+1].filter(function(props){return props.sequence === 'good'});
						arrParentUnits.forEach(function(parent){
							if (!assocChildrenInfosRAM[parent.unit]) {
								if (!storage.assocStableUnitsByMci[parent.main_chain_index+1]) { // hack for genesis unit where we lose hc
									if (since_mc_index == 0)
										return;
									throwError("no storage.assocStableUnitsByMci[parent.main_chain_index+1] on " + parent.unit);
								}
								var next_mc_unit_props = storage.assocStableUnitsByMci[parent.main_chain_index+1].find(function(props){return props.is_on_main_chain});
								if (!next_mc_unit_props) {
									throwError("no next_mc_unit found for unit " + parent.unit);
								}
								var next_mc_unit = next_mc_unit_props.unit;
								var filter_func = function(child){
									return (child.sequence === 'good' && child.parent_units && child.parent_units.indexOf(parent.unit) > -1);
								};
								var arrSameMciChildren = storage.assocStableUnitsByMci[parent.main_chain_index].filter(filter_func);
								var arrNextMciChildren = storage.assocStableUnitsByMci[parent.main_chain_index+1].filter(filter_func);
								var arrCandidateChildren = arrSameMciChildren.concat(arrNextMciChildren);
								var children = arrCandidateChildren.map(function(child){
									return {child_unit: child.unit, next_mc_unit: next_mc_unit};
								});
							//	var children = _.map(_.pickBy(storage.assocStableUnits, function(v, k){return (v.main_chain_index - props.main_chain_index == 1 || v.main_chain_index - props.main_chain_index == 0) && v.parent_units.indexOf(props.unit) > -1 && v.sequence === 'good';}), function(props, unit){return {child_unit: unit, next_mc_unit: next_mc_unit}});
								assocChildrenInfosRAM[parent.unit] = {headers_commission: parent.headers_commission, children: children};
							}
						});
						var assocChildrenInfos = conf.bFaster ? assocChildrenInfosRAM : {};
						// sql result
						if (!conf.bFaster){
							rows.forEach(function(row){
								var payer_unit = row.payer_unit;
								var child_unit = row.child_unit;
								if (!assocChildrenInfos[payer_unit])
									assocChildrenInfos[payer_unit] = {headers_commission: row.headers_commission, children: []};
								else if (assocChildrenInfos[payer_unit].headers_commission !== row.headers_commission)
									throw Error("different headers_commission");
								delete row.headers_commission;
								delete row.payer_unit;
								assocChildrenInfos[payer_unit].children.push(row);
							});
							if (!_.isEqual(assocChildrenInfos, assocChildrenInfosRAM)) {
								// try sort children
								var assocChildrenInfos2 = _.cloneDeep(assocChildrenInfos);
								_.forOwn(assocChildrenInfos2, function(props, unit){
									props.children = _.sortBy(props.children, ['child_unit']);
								});
								_.forOwn(assocChildrenInfosRAM, function(props, unit){
									props.children = _.sortBy(props.children, ['child_unit']);
								});
								if (!_.isEqual(assocChildrenInfos2, assocChildrenInfosRAM))
									throwError("different assocChildrenInfos, db: "+JSON.stringify(assocChildrenInfos)+", ram: "+JSON.stringify(assocChildrenInfosRAM));
							}
						}
						
						var assocWonAmounts = {}; // amounts won, indexed by child unit who won the hc, and payer unit
						for (var payer_unit in assocChildrenInfos){
							var headers_commission = assocChildrenInfos[payer_unit].headers_commission;
							var winnerChildInfo = getWinnerInfo(assocChildrenInfos[payer_unit].children);
							var child_unit = winnerChildInfo.child_unit;
							if (!assocWonAmounts[child_unit])
								assocWonAmounts[child_unit] = {};
							assocWonAmounts[child_unit][payer_unit] = headers_commission;
						}
						//console.log(assocWonAmounts);
						var arrWinnerUnits = Object.keys(assocWonAmounts);
						if (arrWinnerUnits.length === 0)
							return cb();
						var strWinnerUnitsList = arrWinnerUnits.map(db.escape).join(', ');
						conn.cquery(
							"SELECT \n\
								unit_authors.unit, \n\
								unit_authors.address, \n\
								100 AS earned_headers_commission_share \n\
							FROM unit_authors \n\
							LEFT JOIN earned_headers_commission_recipients USING(unit) \n\
							WHERE unit_authors.unit IN("+strWinnerUnitsList+") AND earned_headers_commission_recipients.unit IS NULL \n\
							UNION ALL \n\
							SELECT \n\
								unit, \n\
								address, \n\
								earned_headers_commission_share \n\
							FROM earned_headers_commission_recipients \n\
							WHERE unit IN("+strWinnerUnitsList+")",
							function(profit_distribution_rows){
								// in-memory
								var arrValuesRAM = [];
								for (var child_unit in assocWonAmounts){
									var objUnit = storage.assocStableUnits[child_unit];
									for (var payer_unit in assocWonAmounts[child_unit]){
										var full_amount = assocWonAmounts[child_unit][payer_unit];
										if (objUnit.earned_headers_commission_recipients) { // multiple authors or recipient is another address
											for (var address in objUnit.earned_headers_commission_recipients) {
												var share = objUnit.earned_headers_commission_recipients[address];
												var amount = Math.round(full_amount * share / 100.0);
												arrValuesRAM.push("('"+payer_unit+"', '"+address+"', "+amount+")");
											};
										} else
											arrValuesRAM.push("('"+payer_unit+"', '"+objUnit.author_addresses[0]+"', "+full_amount+")");
									}
								}
								// sql result
								var arrValues = conf.bFaster ? arrValuesRAM : [];
								if (!conf.bFaster){
									profit_distribution_rows.forEach(function(row){
										var child_unit = row.unit;
										for (var payer_unit in assocWonAmounts[child_unit]){
											var full_amount = assocWonAmounts[child_unit][payer_unit];
											if (!full_amount)
												throw Error("no amount for child unit "+child_unit+", payer unit "+payer_unit);
											// note that we round _before_ summing up header commissions won from several parent units
											var amount = (row.earned_headers_commission_share === 100) 
												? full_amount 
												: Math.round(full_amount * row.earned_headers_commission_share / 100.0);
											// hc outputs will be indexed by mci of _payer_ unit
											arrValues.push("('"+payer_unit+"', '"+row.address+"', "+amount+")");
										}
									});
									if (!_.isEqual(arrValuesRAM.sort(), arrValues.sort())) {
										throwError("different arrValues, db: "+JSON.stringify(arrValues)+", ram: "+JSON.stringify(arrValuesRAM));
									}
								}

								conn.query("INSERT INTO headers_commission_contributions (unit, address, amount) VALUES "+arrValues.join(", "), function(){
									cb();
								});
							}
						);
					}
				);
			} // sqlite
		},
		function(cb){
			conn.query(
				"INSERT INTO headers_commission_outputs (main_chain_index, address, amount) \n\
				SELECT main_chain_index, address, SUM(amount) FROM headers_commission_contributions JOIN units USING(unit) \n\
				WHERE main_chain_index>? \n\
				GROUP BY main_chain_index, address",
				[since_mc_index],
				function(){
					if (conf.bFaster)
						return cb();
					conn.query("SELECT DISTINCT main_chain_index FROM headers_commission_contributions JOIN units USING(unit) WHERE main_chain_index>?", [since_mc_index], function(contrib_rows){
						if (contrib_rows.length === 1 && contrib_rows[0].main_chain_index === since_mc_index+1 || since_mc_index === 0)
							return cb();
						throwError("since_mc_index="+since_mc_index+" but contributions have mcis "+contrib_rows.map(function(r){ return r.main_chain_index}).join(', '));
					});
				}
			);
		},
		function(cb){
			conn.query("SELECT MAX(main_chain_index) AS max_spendable_mci FROM headers_commission_outputs", function(rows){
				max_spendable_mci = rows[0].max_spendable_mci;
				cb();
			});
		}
	], onDone);

}

function getWinnerInfo(arrChildren){
	if (arrChildren.length === 1)
		return arrChildren[0];
	arrChildren.forEach(function(child){
		child.hash = crypto.createHash("sha1").update(child.child_unit + child.next_mc_unit, "utf8").digest("hex");
	});
	arrChildren.sort(function(a, b){ return ((a.hash < b.hash) ? -1 : 1); });
	return arrChildren[0];
}

function initMaxSpendableMci(conn, onDone){
	conn.query("SELECT MAX(main_chain_index) AS max_spendable_mci FROM headers_commission_outputs", function(rows){
		max_spendable_mci = rows[0].max_spendable_mci || 0; // should be -1, we lose headers commissions paid by genesis unit
		if (onDone)
			onDone();
	});
}

function resetMaxSpendableMci(){
	max_spendable_mci = null;
}

function getMaxSpendableMciForLastBallMci(last_ball_mci){
	return last_ball_mci - 1;
}

function throwError(msg){
	var eventBus = require('./event_bus.js');
	debugger;
	if (typeof window === 'undefined')
		throw Error(msg);
	else
		eventBus.emit('nonfatal_error', msg, new Error());
}

exports.resetMaxSpendableMci = resetMaxSpendableMci;
exports.calcHeadersCommissions = calcHeadersCommissions;
exports.getMaxSpendableMciForLastBallMci = getMaxSpendableMciForLastBallMci;

