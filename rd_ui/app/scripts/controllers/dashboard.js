(function() {
  var DashboardCtrl = function($scope, Events, Widget, $routeParams, $location, $http, $timeout, $q, Dashboard) {
    $scope.refreshEnabled = false;
    $scope.refreshRate = 60;

    var loadDashboard = _.throttle(function() {
      $scope.dashboard = Dashboard.get({ slug: $routeParams.dashboardSlug }, function (dashboard) {
        Events.record(currentUser, "view", "dashboard", dashboard.id);

        $scope.$parent.pageTitle = dashboard.name;

        var promises = [];

        $scope.dashboard.widgets = _.map($scope.dashboard.widgets, function (row) {
          return _.map(row, function (widget) {
            var w = new Widget(widget);

            if (w.visualization) {
              promises.push(w.getQuery().getQueryResult().toPromise());
            }

            return w;
          });
        });

        $q.all(promises).then(function(queryResults) {
          var filters = {};
          _.each(queryResults, function(queryResult) {
            var queryFilters = queryResult.getFilters();
            _.each(queryFilters, function (queryFilter) {
              var hasQueryStringValue = _.has($location.search(), queryFilter.name);

              if (!(hasQueryStringValue || dashboard.dashboard_filters_enabled)) {
                // If dashboard filters not enabled, or no query string value given, skip filters linking.
                return;
              }

              if (!_.has(filters, queryFilter.name)) {
                var filter = _.extend({}, queryFilter);
                filters[filter.name] = filter;
                filters[filter.name].originFilters = [];
                if (hasQueryStringValue) {
                  filter.current = $location.search()[filter.name];
                }

                $scope.$watch(function () { return filter.current }, function (value) {
                  _.each(filter.originFilters, function (originFilter) {
                    originFilter.current = value;
                  });
                });
              }

              // TODO: merge values.
              filters[queryFilter.name].originFilters.push(queryFilter);
            });
          });

          $scope.filters = _.values(filters);
        });


      }, function () {
        // error...
        // try again. we wrap loadDashboard with throttle so it doesn't happen too often.\
        // we might want to consider exponential backoff and also move this as a general solution in $http/$resource for
        // all AJAX calls.
        loadDashboard();
      });
    }, 1000);

    loadDashboard();

    var autoRefresh = function() {
      if ($scope.refreshEnabled) {
        $timeout(function() {
          Dashboard.get({
            slug: $routeParams.dashboardSlug
          }, function(dashboard) {
            var newWidgets = _.groupBy(_.flatten(dashboard.widgets), 'id');

            _.each($scope.dashboard.widgets, function(row) {
              _.each(row, function(widget, i) {
                var newWidget = newWidgets[widget.id];
                if (newWidget && newWidget[0].visualization.query.latest_query_data_id != widget.visualization.query.latest_query_data_id) {
                  row[i] = new Widget(newWidget[0]);
                }
              });
            });

            autoRefresh();
          });

        }, $scope.refreshRate);
      }
    };

    $scope.triggerRefresh = function() {
      $scope.refreshEnabled = !$scope.refreshEnabled;

      Events.record(currentUser, "autorefresh", "dashboard", dashboard.id, {'enable': $scope.refreshEnabled});

      if ($scope.refreshEnabled) {
        var refreshRate = _.min(_.flatten($scope.dashboard.widgets), function(widget) {
          return widget.visualization.query.ttl;
        }).visualization.query.ttl;

        $scope.refreshRate = _.max([120, refreshRate * 2]) * 1000;

        autoRefresh();
      }
    };
  };

  var WidgetCtrl = function($scope, $location, Events, Query) {
    $scope.deleteWidget = function() {
      if (!confirm('Are you sure you want to remove "' + $scope.widget.getName() + '" from the dashboard?')) {
        return;
      }

      Events.record(currentUser, "delete", "widget", $scope.widget.id);

      $scope.widget.$delete(function() {
        $scope.dashboard.widgets = _.map($scope.dashboard.widgets, function(row) {
          return _.filter(row, function(widget) {
            return widget.id != undefined;
          })
        });
      });
    };

    Events.record(currentUser, "view", "widget", $scope.widget.id);

    if ($scope.widget.visualization) {
      Events.record(currentUser, "view", "query", $scope.widget.visualization.query.id);
      Events.record(currentUser, "view", "visualization", $scope.widget.visualization.id);

      $scope.query = $scope.widget.getQuery();
      var parameters = Query.collectParamsFromQueryString($location, $scope.query);
      var maxAge = $location.search()['maxAge'];
      $scope.queryResult = $scope.query.getQueryResult(maxAge, parameters);
      $scope.nextUpdateTime = moment(new Date(($scope.query.updated_at + $scope.query.ttl + $scope.query.runtime + 300) * 1000)).fromNow();

      $scope.type = 'visualization';
    } else {
      $scope.type = 'textbox';
    }
  };

  angular.module('redash.controllers')
    .controller('DashboardCtrl', ['$scope', 'Events', 'Widget', '$routeParams', '$location', '$http', '$timeout', '$q', 'Dashboard', DashboardCtrl])
    .controller('WidgetCtrl', ['$scope', '$location', 'Events', 'Query', WidgetCtrl])

})();
